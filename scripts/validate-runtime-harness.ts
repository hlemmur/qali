import { loadHarnessProfiles } from '@qali/agent-runtime/harness-profiles';
import { loadRuntimeSkillAssets } from '@qali/agent-runtime/skill-assets';

const skills = loadRuntimeSkillAssets('skills/runtime');
const profiles = loadHarnessProfiles('harness/profiles.json', 'skills/runtime');

process.stdout.write(
  `${JSON.stringify({ valid: true, skills: skills.length, profiles: profiles.length })}\n`
);
