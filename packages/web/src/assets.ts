/** Textos de config/ e data/ embutidos no build (lidos pelo Vite). */

const configModules = import.meta.glob("../../../config/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});
const dataModules = import.meta.glob(["../../../data/*.yaml", "../../../data/*.json"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function byFileName(mods: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(mods)) out[path.split("/").pop()!] = text as string;
  return out;
}

export const configTexts = byFileName(configModules);
export const dataTexts = byFileName(dataModules);
