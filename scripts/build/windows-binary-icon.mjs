import { readFile, writeFile } from "node:fs/promises";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

const [runtimePath, iconPath, destination] = process.argv.slice(2);

const runtime = NtExecutable.from(await readFile(runtimePath), { ignoreCert: true });
const resources = NtExecutableResource.from(runtime);
const group = Resource.IconGroupEntry.fromEntries(resources.entries)[0];
if (!group) throw new Error("The Bun Windows runtime has no icon resource group.");

const icon = Data.IconFile.from(await readFile(iconPath));
Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries, group.id, group.lang, icon.icons.map((entry) => entry.data),
);
resources.outputResource(runtime);
await writeFile(destination, Buffer.from(runtime.generate()));
