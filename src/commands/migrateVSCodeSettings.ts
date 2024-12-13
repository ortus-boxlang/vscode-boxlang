import { migrateSettings } from "../settingMigration";

export async function migrateVSCodeSettings() {
    migrateSettings(true);
}