import {seed} from '../src/lib/domain.ts';
import {writeFileSync} from 'node:fs';
writeFileSync('review-evidence/demo-seed.json',JSON.stringify({kind:'synthetic-seed-no-real-users',state:seed()},null,2));
