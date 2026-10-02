const test=require('node:test');
const assert=require('node:assert/strict');
const {loadMobileModule}=require('./helpers/mobileHarness.cjs');
const {AndroidSegmentExecutionHost}=loadMobileModule('mobile/src/phase6ExecutionHost.ts');
test('Android host preserves user/system pause, waits for unlock and never revives a deleted project', async()=>{
  let run={runId:'r',worldId:'w',status:'queued'},exists=true,unlocked=false,launches=0;
  const host=new AndroidSegmentExecutionHost({runs:{async getRun(){return run},async listUnits(){return[]},async setRunStatus(id,status){run.status=status},
    async requestSystemPause(){if(['paused_user','stopped_user','canceled','completed'].includes(run.status))return false;run.status='paused_system';return true}},
    async projectExists(){return exists},async credentialsAvailable(){return unlocked},async launch(){launches++},
    async controlRun(id,cmd){run.status=cmd==='resume'?'queued':cmd==='pause'?'paused_user':'canceled'}});
  await host.start('r');assert.equal(run.status,'waiting_unlock');assert.equal(launches,0);
  unlocked=true;await host.start('r');assert.equal(launches,1);
  run.status='paused_user';await host.start('r');assert.equal(launches,1);
  await host.control('r','resume');assert.equal(launches,2);
  await host.systemPaused('r','fgs_dataSync_timeout');assert.equal(run.status,'paused_system');
  await host.start('r');assert.equal(launches,2);
  exists=false;await host.control('r','resume');assert.equal(run.status,'paused_system');assert.equal(launches,2);
});

test('Android host refuses unknown unit outcomes and persisted control flags before starting or resuming', async()=>{
  let run={runId:'r',worldId:'w',status:'queued',pauseRequested:false,cancelRequested:false,lastErrorCode:null};
  let units=[{status:'needs_review',errorCode:'outcome_unknown'}],launches=0,controls=0;
  const host=new AndroidSegmentExecutionHost({runs:{async getRun(){return run},async listUnits(){return units},async setRunStatus(id,status){run.status=status}},
    async projectExists(){return true},async credentialsAvailable(){return true},async launch(){launches++},async controlRun(){controls++}});
  await host.start('r');await host.control('r','resume');assert.equal(launches,0);assert.equal(controls,0);
  units=[];run.pauseRequested=true;await host.start('r');assert.equal(launches,0);
  run.pauseRequested=false;run.cancelRequested=true;await host.start('r');assert.equal(launches,0);
  run.cancelRequested=false;await host.start('r');assert.equal(launches,1);
});

test('Android unlock completion cannot revive a project or overwrite a user pause that arrived while waiting', async()=>{
  let run={runId:'r',worldId:'w',status:'queued',pauseRequested:false,cancelRequested:false};let exists=true,launches=0,writes=0;
  let resolveUnlock;
  const host=new AndroidSegmentExecutionHost({runs:{async getRun(){return run},async listUnits(){return[]},async setRunStatus(id,status){writes++;run.status=status}},
    async projectExists(){return exists},credentialsAvailable(){return new Promise(resolve=>{resolveUnlock=resolve})},
    async launch(){launches++},async controlRun(){}});
  const starting=host.start('r');while(!resolveUnlock)await new Promise(resolve=>setImmediate(resolve));
  run.status='paused_user';run.pauseRequested=true;resolveUnlock(false);await starting;
  assert.equal(run.status,'paused_user');assert.equal(writes,0);assert.equal(launches,0);
  run.status='queued';run.pauseRequested=false;resolveUnlock=null;
  const second=host.start('r');while(!resolveUnlock)await new Promise(resolve=>setImmediate(resolve));
  exists=false;resolveUnlock(true);await second;assert.equal(launches,0);assert.equal(writes,0);
});

test('Android system pause delegates to the atomic run owner and preserves a competing user control',async()=>{
  let run={runId:'r',worldId:'w',status:'running'},casCalls=0,userPauseCalls=0;
  const host=new AndroidSegmentExecutionHost({runs:{async getRun(){return run},async listUnits(){return[]},async setRunStatus(){throw new Error('non-atomic status write')},
    async requestSystemPause(){casCalls++;run.status='paused_user';return false}},
    async projectExists(){return true},async credentialsAvailable(){return true},async launch(){},async controlRun(){userPauseCalls++}});
  await host.systemPaused('r','background_start_denied');assert.equal(run.status,'paused_user');assert.equal(casCalls,1);assert.equal(userPauseCalls,0);
});
