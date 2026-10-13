/** Instance `worker@host:pid` → `host:pid` cho gọn. */
export const instanceLabel = (id: string) => (id.includes('@') ? id.slice(id.indexOf('@') + 1) : id);
