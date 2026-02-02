import api from '../utils/api';
import type { paths } from './generated/types';

type ApiPathKey = keyof paths & string;

type PostPath = {
  [K in ApiPathKey]: paths[K] extends { post: unknown } ? K : never;
}[ApiPathKey];

type PutPath = {
  [K in ApiPathKey]: paths[K] extends { put: unknown } ? K : never;
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

type RequestBodyFor<T> =
  T extends { requestBody: { content: { 'application/json': infer Body } } }
    ? Body
    : T extends { requestBody?: { content: { 'application/json': infer Body } } }
      ? Body
      : undefined;

type ResponseBodyFor<T> = T extends { responses: { 200: { content: { 'application/json': infer Body } } } }
  ? Body
  : never;

type QueryFor<T> = T extends { parameters: { query: infer Query } } ? Query : undefined;

type PostRequestBody<P extends PostPath> = RequestBodyFor<paths[P]['post']>;
type PostResponseBody<P extends PostPath> = ResponseBodyFor<paths[P]['post']>;

type PutRequestBody<P extends PutPath> = RequestBodyFor<paths[P]['put']>;
type PutResponseBody<P extends PutPath> = ResponseBodyFor<paths[P]['put']>;

type PatchRequestBody<P extends PatchPath> = RequestBodyFor<paths[P]['patch']>;
type PatchResponseBody<P extends PatchPath> = ResponseBodyFor<paths[P]['patch']>;

type DeleteRequestBody<P extends DeletePath> = RequestBodyFor<paths[P]['delete']>;
type DeleteResponseBody<P extends DeletePath> = ResponseBodyFor<paths[P]['delete']>;

type GetResponseBody<P extends GetPath> = ResponseBodyFor<paths[P]['get']>;
type GetQuery<P extends GetPath> = QueryFor<paths[P]['get']>;

type PathParamsShape = Record<string, string | number | boolean>;

type GetPathParams<P extends GetPath> =
  paths[P] extends { get: { parameters: { path: infer Params } } }
    ? Params extends PathParamsShape
      ? Params
      : PathParamsShape
    : undefined;

type PostPathParams<P extends PostPath> =
  paths[P] extends { post: { parameters: { path: infer Params } } }
    ? Params extends PathParamsShape
      ? Params
      : PathParamsShape
    : undefined;

type PutPathParams<P extends PutPath> =
  paths[P] extends { put: { parameters: { path: infer Params } } }
    ? Params extends PathParamsShape
      ? Params
      : PathParamsShape
    : undefined;

type PatchPathParams<P extends PatchPath> =
  paths[P] extends { patch: { parameters: { path: infer Params } } }
    ? Params extends PathParamsShape
      ? Params
      : PathParamsShape
    : undefined;

type DeletePathParams<P extends DeletePath> =
  paths[P] extends { delete: { parameters: { path: infer Params } } }
    ? Params extends PathParamsShape
      ? Params
      : PathParamsShape
    : undefined;

function resolvePath<P extends ApiPathKey>(path: P, params?: Record<string, string | number | boolean> | undefined): string {
  if (!params) return path;
  let resolved = path as string;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

export async function post<P extends PostPath>(
  path: P,
  body: PostRequestBody<P>,
  pathParams?: PostPathParams<P>
): Promise<PostResponseBody<P>> {
  const response = await api.post(resolvePath(path, pathParams), body);
  return response.data as PostResponseBody<P>;
}

export async function put<P extends PutPath>(
  path: P,
  body: PutRequestBody<P>,
  pathParams?: PutPathParams<P>
): Promise<PutResponseBody<P>> {
  const response = await api.put(resolvePath(path, pathParams), body);
  return response.data as PutResponseBody<P>;
}

export async function patch<P extends PatchPath>(
  path: P,
  body: PatchRequestBody<P>,
  pathParams?: PatchPathParams<P>
): Promise<PatchResponseBody<P>> {
  const response = await api.patch(resolvePath(path, pathParams), body);
  return response.data as PatchResponseBody<P>;
}

export async function del<P extends DeletePath>(
  path: P,
  body?: DeleteRequestBody<P>,
  pathParams?: DeletePathParams<P>
): Promise<DeleteResponseBody<P>> {
  const response = await api.delete(resolvePath(path, pathParams), body ? { data: body } : undefined);
  return response.data as DeleteResponseBody<P>;
}

export async function get<P extends GetPath>(
  path: P,
  query?: GetQuery<P>,
  pathParams?: GetPathParams<P>
): Promise<GetResponseBody<P>> {
  const response = await api.get(resolvePath(path, pathParams), query ? { params: query } : undefined);
  return response.data as GetResponseBody<P>;
}
