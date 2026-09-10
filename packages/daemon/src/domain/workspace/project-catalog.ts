import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

export class ProjectReadError extends Error {
  constructor(readonly code: string, message: string, readonly candidates?: string[]) { super(message); }
}
export function yamlObject(file: string): Record<string, any> {
  try {
    const value = parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a YAML object");
    return value;
  } catch (err) { throw new ProjectReadError("workspace_catalog_invalid", `${file}: ${(err as Error).message}`); }
}
/** The existing workspace.yaml catalog, shared by work-install and project reads. */
export function readProjectCatalog(catalogPath: string): Array<{ id: string; root: string }> | null {
  if (!fs.existsSync(catalogPath)) return null;
  const entries = yamlObject(catalogPath).projects;
  if (!Array.isArray(entries) || entries.some(e => !e || typeof e.id !== "string" || typeof e.root !== "string"))
    throw new ProjectReadError("workspace_catalog_invalid", `${catalogPath} projects must each declare string id and root values`);
  const ids = entries.map(e => e.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new ProjectReadError("project_identity_ambiguous", `project id '${duplicate}' names multiple roots in ${catalogPath}`);
  return entries.map(e => ({ id: e.id, root: e.root }));
}
export function selectCatalogProject(catalogPath: string, selectedId?: string): { id: string; root: string } | null {
  const projects = readProjectCatalog(catalogPath);
  if (!projects) return null;
  const candidates = projects.map(p => p.id);
  const id = selectedId ?? (projects.length === 1 ? projects[0]!.id : undefined);
  if (!id) throw new ProjectReadError("project_required", "multiple projects are declared; select one with --project", candidates);
  const selected = projects.find(p => p.id === id);
  if (!selected) throw new ProjectReadError("project_not_found", `project '${id}' is not declared in ${catalogPath}`, candidates);
  const nominal = path.resolve(path.dirname(catalogPath), selected.root);
  try { return { id, root: fs.realpathSync(nominal) }; }
  catch { throw new ProjectReadError("project_root_missing", `project '${id}' root does not exist: ${nominal}`); }
}
/** Exact project membership; unscoped historical rows are not assigned to a selected project. */
export function belongsToProject(raw: string | null | undefined, id: string): boolean {
  try {
    const tags: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(tags) && tags.flatMap(t => typeof t === "string" ? t.split(",").map(s => s.trim()) : []).includes(`project:${id}`);
  } catch { return false; }
}
