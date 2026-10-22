export async function getAuthenticatedUser(client: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
}) {
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError("too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
