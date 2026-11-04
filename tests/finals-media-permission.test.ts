import test from 'node:test';import assert from 'node:assert/strict';import {validationFixture} from '../scripts/life-validation-fixture.ts';import {mirrorItemGrant} from '../src/lib/foundation/policy.ts';import {readMedia} from '../src/lib/life/stories.ts';
import {migrateUnified} from '../src/lib/foundation/schema.ts';
test('照片读取服从当前按件授权：撤权后旧shared投影不能恢复照片权限，本人原上传保留',t=>{
 const f=validationFixture('.runtime/finals-media-revoke-'+crypto.randomUUID());t.after(()=>f.db.close());migrateUnified(f.db);const id=f.add('[合成]可共享照片的物品','其他','','');const media=crypto.randomUUID(),s=f.read(),item=s.items.find(i=>i.id===id)!;item.owner='dad';item.shared=true;item.sharedWith=['lin'];item.photo='/api/life/media/'+media;f.write(s);f.db.prepare('INSERT INTO life_media VALUES(?,?,?,?)').run(media,'dad','image/jpeg',Buffer.from('synthetic-policy-fixture-not-image'));
 mirrorItemGrant(f.db,f.read(),'dad','lin',id,true);assert.ok(readMedia(f.db,f.read(),'lin',media));mirrorItemGrant(f.db,f.read(),'dad','lin',id,false);
 assert.throws(()=>readMedia(f.db,f.read(),'lin',media),/授权/,'撤权记录必须覆盖过时的shared标志');assert.ok(readMedia(f.db,f.read(),'dad',media),'上传者仍可访问自己的原始私人媒体');
});
