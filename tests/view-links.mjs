import assert from 'node:assert/strict';

// Run against disposable PostgreSQL/PGlite only. Never targets the live project.
export async function testViewLinks(PGlite, migration) {
  const pg = new PGlite();
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const trip='11111111-1111-4111-8111-111111111111', next='22222222-2222-4222-8222-222222222222';
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table public.profiles(id uuid primary key,display_name text,current_trip_id uuid);
    create table public.check_ins(id uuid primary key,user_id uuid,trip_id uuid,place_name text,country_code text,latitude double precision,longitude double precision,created_at timestamptz,message text,photo_path text);
    insert into profiles values ('${owner}','Owner','${trip}'),('${other}','Other','${next}');
    insert into check_ins values ('33333333-3333-4333-8333-333333333333','${owner}','${trip}','Hanoi','VN',21.0234,105.8345,now(),'private note','private.jpg'),
    ('44444444-4444-4444-8444-444444444444','${owner}','${next}','Other trip','VN',1,2,now(),'private','private.jpg');`);
  await pg.exec(migration);
  await pg.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
  await assert.rejects(pg.query('select public.create_trip_view_link(0)'));
  const result=await pg.query('select (public.create_trip_view_link(7)).token');
  const token=result.rows[0].token;
  await pg.exec(`set request.jwt.claim.sub='${other}';`);
  assert.equal((await pg.query('select * from trip_view_links')).rows.length,0);
  assert.equal((await pg.query('delete from trip_view_links returning token')).rows.length,0);
  await assert.rejects(pg.query(`insert into trip_view_links(owner_id,trip_id,expires_at) values ('${owner}','${trip}',now()+interval '1 day')`));
  await pg.exec(`reset role; set role anon; set request.jwt.claim.sub='';`);
  await assert.rejects(pg.query('select * from trip_view_links'));
  await assert.rejects(pg.query('select public.create_trip_view_link(7)'));
  const read=async t=>(await pg.query('select public.get_shared_trip($1) as data',[t])).rows[0].data;
  let data=await read(token);
  assert.equal(data.check_ins.length,1);assert.equal(data.check_ins[0].latitude,21.02);
  assert.equal(data.check_ins[0].message,undefined);assert.equal(data.check_ins[0].photo_path,undefined);
  assert.deepEqual(Object.keys(data).sort(),['check_ins','display_name','expires_at']);
  assert.equal(await read('99999999-9999-4999-8999-999999999999'),null);
  await pg.exec(`reset role; update profiles set current_trip_id='${next}' where id='${owner}'; set role anon;`);
  assert.equal((await read(token)).check_ins[0].place_name,'Hanoi');
  await pg.exec(`reset role; update trip_view_links set created_at=now()-interval '2 days', expires_at=now()-interval '1 day'; set role anon;`);
  assert.equal(await read(token),null);
  await pg.exec(`reset role; update trip_view_links set expires_at=now()+interval '1 day'; set role authenticated; set request.jwt.claim.sub='${owner}'; delete from trip_view_links; reset role; set role anon;`);
  assert.equal(await read(token),null);
  await pg.close();
  return 'Passed: owner-only management, anonymous read-only access, invalid tokens, field restrictions, trip isolation, expiry and cancellation';
}
