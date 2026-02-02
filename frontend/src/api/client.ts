import api from '../utils/api';
import type { paths } from './generated/types';

type ApiPathKey = keyof paths & string;

type PostPath = {
  [K in ApiPathKey]: paths[K] extends { post: unknown } ? K : never;
}[ApiPathKey];

type PatchPath = {
  [K in ApiPathKey]: paths[K] extends { patch: unknown } ? K : never;
}[ApiPathKey];

type DeletePath = {
  [K in ApiPathKey]: paths[K] extends { delete: unknown } ? K : never;
}[ApiPathKey];

type GetPath = {
  [K in ApiPathKey]: paths[K] extends { get: unknown } ? K : never;
}[ApiPathKey];

type PostRequestBody<P extends PostPath> =
  paths[P] extends {
    post: { requestBody: { content: { 'application/json': infer Body } } };
  }
    ? Body
    : undefined;

type PostResponseBody<P extends PostPath> =
  paths[P] extends {
    post: { responses: { 200: { content: { 'application/json': infer Body } } } };
  }
    ? Body
    : never;

type PatchRequestBody<P extends PatchPath> =
  paths[P] extends {
    patch: { requestBody: { content: { 'application/json': infer Body } } };
  }
    ? Body
    : undefined;

type PatchResponseBody<P extends PatchPath> =
  paths[P] extends {
    patch: { responses: { 200: { content: { 'application/json': infer Body } } } };
  }
    ? Body
    : never;

type DeleteRequestBody<P extends DeletePath> =
  paths[P] extends {
    delete: { requestBody: { content: { 'application/json': infer Body } } };
  }
    ? Body
    : undefined;

type DeleteResponseBody<P extends DeletePath> =
  paths[P] extends {
    delete: { responses: { 200: { content: { 'application/json': infer Body } } } };
  }
    ? Body
    : never;

type GetResponseBody<P extends GetPath> =
  paths[P] extends {
    get: { responses: { 200: { content: { 'application/json': infer Body } } } };
  }
    ? Body
    : never;

type GetQuery<P extends GetPath> =
  paths[P] extends {
    get: { parameters: { query: infer Query } };
  }
    ? Query
    : undefined;

type PathParams<P extends ApiPathKey> =
  paths[P] extends { parameters: { path: infer Params } } ? Params : undefined;

function resolvePath<P extends ApiPathKey>(path: P, params?: PathParams<P>): string {
  if (!params) return path;
  let resolved = path as string;
  for (const [key, value] of Object.entries(params as Record<string, string | number | boolean>)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

export async function post<P extends PostPath>(
  path: P,
  body: PostRequestBody<P>,
  pathParams?: PathParams<P>
): Promise<PostResponseBody<P>> {
  const response = await api.post(resolvePath(path, pathParams), body);
  return response.data as PostResponseBody<P>;
}

export async function patch<P extends PatchPath>(
  path: P,
  body: PatchRequestBody<P>,
  pathParams?: PathParams<P>
): Promise<PatchResponseBody<P>> {
  const response = await api.patch(resolvePath(path, pathParams), body);
  return response.data as PatchResponseBody<P>;
}

export async function del<P extends DeletePath>(
  path: P,
  body?: DeleteRequestBody<P>,
  pathParams?: PathParams<P>
): Promise<DeleteResponseBody<P>> {
  const response = await api.delete(resolvePath(path, pathParams), body ? { data: body } : undefined);
  return response.data as DeleteResponseBody<P>;
}

export async function get<P extends GetPath>(
  path: P,
  query?: GetQuery<P>,
  pathParams?: PathParams<P>
): Promise<GetResponseBody<P>> {
  const response = await api.get(resolvePath(path, pathParams), query ? { params: query } : undefined);
  return response.data as GetResponseBody<P>;
}
