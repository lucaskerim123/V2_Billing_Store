// Compose immutable Base snapshots without dropping earlier successful patches.
export function composeBaseReleaseFiles(baseFiles, previousPatches, nextPatch) {
  const merged = new Map(baseFiles.map(file => [file.file, file]));
  const apply = patch => {
    for (const path of patch.deletePaths || []) merged.delete(path);
    for (const file of patch.files || []) merged.set(file.file, file);
  };
  for (const patch of previousPatches) apply(patch);
  apply(nextPatch);
  return [...merged.values()].sort((a,b)=>a.file.localeCompare(b.file));
}
