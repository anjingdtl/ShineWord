import type { SqliteDatabase } from '../../application/ports/sqlite';
import { reviveRunConfig, type FrozenRunConfig } from '../../application/worldBuild/runConfig';
import type { Sha256HexProvider } from '../../domain/turns/canonical';
export const PHASE6_EXECUTION_CONFIG_SQL = `
CREATE TABLE world_segment_execution_configs (
 world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL, config_json TEXT NOT NULL,
 PRIMARY KEY(world_id,fingerprint)
);`;
/** Frozen input assets only. Execution states/leases remain in world_build_runs. */
export class SqliteSegmentExecutionConfigStore {
  constructor(private readonly db: SqliteDatabase, private readonly hash: Sha256HexProvider) {}
  async register(worldId: string, config: FrozenRunConfig): Promise<string> {
    const json = JSON.stringify(config);
    if (!reviveRunConfig(json)) throw new Error('invalid_frozen_config');
    const fingerprint = await this.hash.sha256Hex(json);
    await this.db.execute('INSERT OR IGNORE INTO world_segment_execution_configs(world_id,fingerprint,config_json) VALUES (?,?,?)',
      [worldId,fingerprint,json]);
    return fingerprint;
  }
  async get(worldId: string, fingerprint: string): Promise<FrozenRunConfig> {
    const row = await this.db.queryOne<{ config_json: string }>(
      'SELECT config_json FROM world_segment_execution_configs WHERE world_id=? AND fingerprint=?', [worldId,fingerprint]);
    if (!row || await this.hash.sha256Hex(row.config_json) !== fingerprint) throw new Error('frozen_execution_config_missing');
    const config = reviveRunConfig(row.config_json);
    if (!config) throw new Error('invalid_frozen_config');
    return config;
  }
}
