import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {authCreateSession} from '../worker/auth.mjs';
export const AUTH_ENV={AUTH_BASE_URL:'https://api.challenge.example',AUTH_FRONTEND_URL:'https://challenge.example/challenge/',AUTH_SESSION_SECRET:'SYNTHETIC_TEST_SESSION_SECRET_32_BYTES_NOT_REAL'};
export const AUTH_USER={id:'U'.repeat(43),name:'Fixture User',provider:'microsoft'};
let sessionArgs;
export const AUTH_SESSION=await authCreateSession({...AUTH_ENV,DB:{prepare(){return {bind(...args){sessionArgs=args;return this;},async run(){return {};}};}}},AUTH_USER);
export function fixtureDB({session=true}={}){
  const db=new DatabaseSync(':memory:');
  for(const migration of ['0000_arena_quota.sql','0001_arena_auth.sql'])db.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
  if(session)db.prepare('INSERT INTO arena_sessions (session_hash,user_id,user_name,provider,expires_at) VALUES (?,?,?,?,?)').run(...sessionArgs);
  return {raw:db,prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async run(){const result=db.prepare(sql).run(...this.args);return {success:true,meta:result};}};},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>({results:db.prepare(s.sql).all(...s.args)}));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
}
