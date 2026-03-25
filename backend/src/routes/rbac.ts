import { FastifyInstance } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { Member } from '../types.js';
import { isServerAdmin } from '../utils/auth.js';
import { getScopeRegistry } from '../utils/scopeRegistry.js';

const roleRuleSchema = z.object({
  scope: z.string().min(1),
  effect: z.enum(['allow', 'deny']),
});

const createRoleSchema = z.object({
  code: z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isAssignable: z.boolean().optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isAssignable: z.boolean().optional(),
});

const replaceRulesSchema = z.object({
  rules: z.array(roleRuleSchema),
});

const assignmentSchema = z.object({
  roleId: z.number().int().positive(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.number().int().nullable().optional(),
});

const replaceAssignmentsSchema = z.object({
  assignments: z.array(assignmentSchema),
});

function requireServerAdmin(member: Member | undefined): member is Member {
  return Boolean(member && isServerAdmin(member));
}

export async function rbacRoutes(fastify: FastifyInstance) {
  fastify.get('/rbac/roles', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const { db, schema } = getDrizzleDb();
    const [roles, rules] = await Promise.all([
      db
        .select({
          id: schema.roles.id,
          code: schema.roles.code,
          name: schema.roles.name,
          description: schema.roles.description,
          isSystem: schema.roles.is_system,
          isComputed: schema.roles.is_computed,
          isAssignable: schema.roles.is_assignable,
        })
        .from(schema.roles)
        .orderBy(asc(schema.roles.code)),
      db
        .select({
          roleId: schema.roleScopeRules.role_id,
          scope: schema.roleScopeRules.scope,
          effect: schema.roleScopeRules.effect,
        })
        .from(schema.roleScopeRules)
        .orderBy(asc(schema.roleScopeRules.scope)),
    ]);

    const rulesByRoleId = new Map<number, Array<{ scope: string; effect: 'allow' | 'deny' }>>();
    for (const rule of rules) {
      const list = rulesByRoleId.get(rule.roleId) ?? [];
      list.push({ scope: rule.scope, effect: rule.effect as 'allow' | 'deny' });
      rulesByRoleId.set(rule.roleId, list);
    }

    return roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem === 1,
      isComputed: role.isComputed === 1,
      isAssignable: role.isAssignable === 1,
      rules: rulesByRoleId.get(role.id) ?? [],
    }));
  });

  fastify.post('/rbac/roles', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const body = createRoleSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const code = body.code ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!code) return reply.code(400).send({ error: 'Could not derive role code' });

    const [created] = await db
      .insert(schema.roles)
      .values({
        code,
        name: body.name,
        description: body.description ?? null,
        is_system: 0,
        is_computed: 0,
        is_assignable: body.isAssignable === false ? 0 : 1,
      })
      .returning({
        id: schema.roles.id,
        code: schema.roles.code,
        name: schema.roles.name,
        description: schema.roles.description,
        isSystem: schema.roles.is_system,
        isComputed: schema.roles.is_computed,
        isAssignable: schema.roles.is_assignable,
      });

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      description: created.description,
      isSystem: created.isSystem === 1,
      isComputed: created.isComputed === 1,
      isAssignable: created.isAssignable === 1,
      rules: [],
    };
  });

  fastify.patch<{ Params: { id: string } }>('/rbac/roles/:id', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const roleId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(roleId)) return reply.code(400).send({ error: 'Invalid role id' });
    const body = updateRoleSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const existing = await db
      .select({
        id: schema.roles.id,
        isSystem: schema.roles.is_system,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1);
    if (!existing[0]) return reply.code(404).send({ error: 'Role not found' });

    await db
      .update(schema.roles)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.isAssignable !== undefined ? { is_assignable: body.isAssignable ? 1 : 0 } : {}),
      })
      .where(eq(schema.roles.id, roleId));

    return { success: true };
  });

  fastify.put<{ Params: { id: string } }>('/rbac/roles/:id/rules', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const roleId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(roleId)) return reply.code(400).send({ error: 'Invalid role id' });
    const body = replaceRulesSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const roleRows = await db
      .select({
        id: schema.roles.id,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1);
    if (!roleRows[0]) return reply.code(404).send({ error: 'Role not found' });

    const deduped = new Map<string, { scope: string; effect: 'allow' | 'deny' }>();
    for (const rule of body.rules) {
      deduped.set(rule.scope, { scope: rule.scope, effect: rule.effect });
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.roleScopeRules).where(eq(schema.roleScopeRules.role_id, roleId));
      const values = Array.from(deduped.values());
      if (values.length > 0) {
        await tx.insert(schema.roleScopeRules).values(
          values.map((rule) => ({
            role_id: roleId,
            scope: rule.scope,
            effect: rule.effect,
          }))
        );
      }
    });

    return { success: true };
  });

  fastify.delete<{ Params: { id: string } }>('/rbac/roles/:id', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });

    const roleId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(roleId)) return reply.code(400).send({ error: 'Invalid role id' });
    const { db, schema } = getDrizzleDb();

    const roleRows = await db
      .select({
        id: schema.roles.id,
        isSystem: schema.roles.is_system,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, roleId))
      .limit(1);
    const role = roleRows[0];
    if (!role) return reply.code(404).send({ error: 'Role not found' });
    if (role.isSystem === 1) return reply.code(400).send({ error: 'Cannot delete a system role' });

    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    return { success: true };
  });

  fastify.get<{ Params: { id: string } }>('/rbac/members/:id/assignments', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
    const memberId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(memberId)) return reply.code(400).send({ error: 'Invalid member id' });

    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.memberRoleAssignments.id,
        roleId: schema.memberRoleAssignments.role_id,
        resourceType: schema.memberRoleAssignments.resource_type,
        resourceId: schema.memberRoleAssignments.resource_id,
        roleCode: schema.roles.code,
        roleName: schema.roles.name,
      })
      .from(schema.memberRoleAssignments)
      .innerJoin(schema.roles, eq(schema.memberRoleAssignments.role_id, schema.roles.id))
      .where(eq(schema.memberRoleAssignments.member_id, memberId))
      .orderBy(asc(schema.roles.code));

    return rows.map((row) => ({
      id: row.id,
      roleId: row.roleId,
      roleCode: row.roleCode,
      roleName: row.roleName,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
    }));
  });

  fastify.put<{ Params: { id: string } }>('/rbac/members/:id/assignments', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
    const memberId = Number.parseInt(request.params.id, 10);
    if (Number.isNaN(memberId)) return reply.code(400).send({ error: 'Invalid member id' });
    if (member.id === memberId) {
      return reply.code(400).send({ error: 'Users cannot assign roles to themselves' });
    }

    const body = replaceAssignmentsSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const targetMemberRows = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1);
    if (!targetMemberRows[0]) return reply.code(404).send({ error: 'Member not found' });

    const roleIds = Array.from(new Set(body.assignments.map((assignment) => assignment.roleId)));
    const roles = roleIds.length === 0
      ? []
      : await db
          .select({
            id: schema.roles.id,
            isAssignable: schema.roles.is_assignable,
          })
          .from(schema.roles)
          .where(inArray(schema.roles.id, roleIds));
    const roleMap = new Map(roles.map((role) => [role.id, role]));

    for (const assignment of body.assignments) {
      const role = roleMap.get(assignment.roleId);
      if (!role) return reply.code(400).send({ error: `Unknown role id ${assignment.roleId}` });
      if (role.isAssignable !== 1) {
        return reply.code(400).send({ error: `Role ${assignment.roleId} is not directly assignable` });
      }
      if ((assignment.resourceType && assignment.resourceId == null) || (!assignment.resourceType && assignment.resourceId != null)) {
        return reply.code(400).send({ error: 'resourceType/resourceId must be set together or both omitted' });
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.memberRoleAssignments)
        .where(eq(schema.memberRoleAssignments.member_id, memberId));

      if (body.assignments.length > 0) {
        await tx.insert(schema.memberRoleAssignments).values(
          body.assignments.map((assignment) => ({
            member_id: memberId,
            role_id: assignment.roleId,
            resource_type: assignment.resourceType ?? null,
            resource_id: assignment.resourceId ?? null,
          }))
        );
      }
    });

    return { success: true };
  });

  fastify.get('/rbac/scopes', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
    const { db, schema } = getDrizzleDb();

    const rows = await db
      .select({ scope: schema.roleScopeRules.scope })
      .from(schema.roleScopeRules)
      .orderBy(asc(schema.roleScopeRules.scope));

    return Array.from(new Set(rows.map((row) => row.scope)));
  });

  /** Documented scopes (categories + descriptions) for admin UI and API consumers. */
  fastify.get('/rbac/scope-registry', async (request, reply) => {
    const member = request.member;
    if (!requireServerAdmin(member)) return reply.code(403).send({ error: 'Forbidden' });
    return { scopes: getScopeRegistry() };
  });
}
