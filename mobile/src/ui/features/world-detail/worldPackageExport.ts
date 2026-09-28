/**
 * Shared world-package export helper.
 *
 * Extracted so both the 书库 card action and the world detail's 世界包 sub-tab
 * call exactly one implementation of the bridge sequence.
 *
 * P3.5: the default file name uses the Shine-TRPG brand prefix while the
 * compatible `.shineword-world.zip` extension stays untouched (plan §3.5/§3.6).
 */
import { exportPortableWorldPackage } from '../../../runtime';
import { createExportBytesFile, writeExportBytes } from '../../../fileBridge';

export async function exportWorldPackageZip(worldId: string): Promise<string> {
  const archive = await exportPortableWorldPackage(worldId);
  const uri = await createExportBytesFile(
    `shine-trpg-${worldId}-r${archive.revision}.shineword-world.zip`,
    'application/zip',
  );
  if (!uri) throw new Error('已取消导出。');
  await writeExportBytes(uri, archive.bytes);
  return `已导出「${archive.title}」r${archive.revision} 世界包 ZIP。这个包包含三宝书与规则，不包含小说原文。`;
}