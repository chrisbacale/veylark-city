const coastalStops=[[-14,-157,2.08],[22,-30,21],[9,147,35],[-34,359,11],[20,573,22],[48,728,41],[-41,735,42],[-54,417,19],[-19,158,34],[-32,-116,26],[-49,-335,7],[-23,-515,3.4]];
const rotorPivots=[[-.735,1.34,.417],[.735,1.34,.417],[-.735,-1.37,.417],[.735,-1.37,.417]];
const wheelIds=['FL','FR','RL','RR'];
let drivingSample,guideIndex=-1;
const journey={seconds:0,metres:0,points:0,beach:false,flyovers:0,ended:false};
function newJourney(){Object.assign(journey,{seconds:0,metres:0,points:0,beach:false,flyovers:0,ended:false});}
function completeJourney(landed=false){
  if(!landed)journey.seconds=timeLimit();journey.ended=true;sim.paused=true;clearInput();
  by('pause-title').textContent=isDispatchFlight()?(landed?'Mission complete':'Time expired'):'Tour complete';
  const elapsed = Math.round(journey.seconds);
  by('controls').textContent=`${formatClock(elapsed)} elapsed · ${(journey.metres / 1000).toFixed(1)} km · ${Math.min(journey.points, 5)}/5 checkpoints`;
  for(const id of ['resume','change','change-tesla','auto','mute'])by(id).hidden=true;
  by('return').textContent='Main menu';by('hud').hidden=true;by('pause').hidden=false;
  by('return').focus({ preventScroll: true });
  if(audio)mix.gain.setTargetAtTime(0,audio.currentTime,.16);
}
function trackClock(dt){
  journey.seconds+=dt;if(journey.seconds>=timeLimit()){completeJourney();return false;}
  return true;
}
function seekRoadGuide(){
  const count=drivingSample.length/52;let closest=67,best=-1;
  for(let n=0;n<count;n+=3){const i=n*52,dx=drivingSample[i]-sim.p.x,dy=drivingSample[i+1]-sim.p.y;
    const cost=dx*dx+dy*dy+6*(1-Math.cos(drivingSample[i+3]-sim.yaw));if(cost<closest){closest=cost;best=n;}}
  guideIndex=best;
}
function sprungRoad(dt,acc,guided){
  const sn=Math.sin(sim.yaw),cs=Math.cos(sim.yaw),h=sim.contactHeight;
  meta.wheels.forEach(([x,y],j)=>{const base=sim.p.z-.017;const height=roadAt(sim.p.x+x*cs+y*sn,sim.p.y-x*sn+y*cs,sim.p.z);h[j]=clamp((height??base)-base,-.14,.14);});
  function spring(target,key,rate){sim[rate]+=(106*(target-sim[key])-12.8*sim[rate])*dt;sim[key]+=sim[rate]*dt;}
  if(!guided){const grade=Math.atan2((h[0]+h[1]-h[2]-h[3])*.5,2.78),camber=Math.atan2((h[0]+h[2]-h[1]-h[3])*.5,1.76);
    spring(grade+.0042*clamp(acc,-13,11.2),'pitch','pitchRate');spring(camber-.0063*sim.turn*sim.speed,'roll','bankRate');}
  spring((h[0]+h[1]+h[2]+h[3])*.25,'heave','heaveRate');
}
function followRoad(dt){
  if(guideIndex<0)return false;
  const cap=drivingSample.length/52-1;guideIndex=Math.min(cap,guideIndex+dt*12);
  const n=Math.floor(guideIndex),i=n*52,j=Math.min(cap,n+1)*52,u=guideIndex-n;
  const get=k=>lerp(drivingSample[i+k],drivingSample[j+k],u);
  const prev=sim.p.clone();sim.p.set(get(0),get(1),get(2));sim.yaw=drivingSample[i+3]+wrap(drivingSample[j+3]-drivingSample[i+3])*u;
  sim.pitch=get(4);sim.roll=get(5);sprungRoad(dt,0,true);sim.speed=get(6);sim.roadAngle=column(get(7),dt);sim.odometer+=sim.p.distanceTo(prev);
  journey.metres+=sim.p.distanceTo(prev);sim.spin=(sim.spin+sim.speed*dt/meta.tyre)%(Math.PI*2);
  sim.driveNode=Math.min(driveRoute.length-1,Math.round(get(10)*12/22));sim.trafficClock=get(11);
  for(let q=0;q<38;q++)sim.trafficDelays[q]=get(q+14);
  if(get(13)>.5&&!journey.beach){journey.beach=true;say('Waterfront reached',3);}
  if(guideIndex>=cap){start('tesla',true);say('Take the Roadster across the bay.',4);}
  return true;
}
function roadsterFlight(dt,turn,power,lift){
  const p=sim.p,previous=p.clone(),q=coastalStops[sim.coastLeg],dx=q[0]-p.x,dy=q[1]-p.y;
  if(sim.guide){const error=wrap(Math.atan2(dx,dy)-sim.yaw);turn=clamp(error*2.65-sim.turn*.7,-1,1);
    sim.target=Math.abs(error)>.65?10:sim.coastLeg===0?15:23;lift=clamp((q[2]-p.z)*.36-sim.climb*.16,-1,1);
  }else sim.target=clamp(sim.target+power*dt*9,0,37);
  const previousVX=sim.vx,previousVY=sim.vy,previousClimb=sim.climb;
  sim.speed+=clamp((sim.target-sim.speed)*2.3,-7.8,4.1)*dt;
  sim.turn=lerp(sim.turn,turn*(.99-.31*clamp(sim.speed/38,0,1)),ease(3.4,dt));sim.yaw+=sim.turn*dt;
  const waves=.10*Math.sin(p.x*.113+p.y*.079-sim.world*1.04)+.045*Math.sin(p.y*.24+sim.world*1.3);
  const wanted=lift*7.2+clamp((1.57+waves-p.z)*2.3,0,2.8);
  sim.climb=lerp(sim.climb,wanted,ease(1.53,dt));
  sim.vx=lerp(sim.vx,Math.sin(sim.yaw)*sim.speed,ease(2.8,dt));sim.vy=lerp(sim.vy,Math.cos(sim.yaw)*sim.speed,ease(2.8,dt));
  if(dt>0){
    const ax=(sim.vx-previousVX)/dt,ay=(sim.vy-previousVY)/dt,upward=Math.max(3.5,9.81+(sim.climb-previousClimb)/dt);
    const ahead=ax*Math.sin(sim.yaw)+ay*Math.cos(sim.yaw)+.00067*sim.speed*sim.speed,across=ax*Math.cos(sim.yaw)-ay*Math.sin(sim.yaw);
    const pitch=clamp(.83*Math.atan2(ahead,upward),-.41,.44),bank=clamp(-.88*Math.atan2(across,upward),-.50,.50);
    sim.pitchRate+=(24*(pitch-sim.pitch)-8.6*sim.pitchRate)*dt;sim.pitch+=sim.pitchRate*dt;
    sim.bankRate+=(24*(bank-sim.roll)-8.6*sim.bankRate)*dt;sim.roll+=sim.bankRate*dt;
    sim.thrust=lerp(sim.thrust,clamp(Math.hypot(upward,ahead,across)/9.81,.57,1.78),ease(6.5,dt));
  }
  const x=clamp(p.x+sim.vx*dt,-540,670),y=clamp(p.y+sim.vy*dt,-770,1100),z=clamp(p.z+sim.climb*dt,1.28,160);
  if(!obstacle(x,y,z,false))p.set(x,y,z);else{sim.speed*=.95;sim.target=Math.min(sim.target,3);if(!obstacle(p.x,p.y,z,false))p.z=z;}
  journey.metres+=p.distanceTo(previous);
  if(Math.hypot(dx,dy)<30){sim.coastLeg=(sim.coastLeg+1)%coastalStops.length;journey.flyovers++;}
}
function roadTraffic(){
  for(let id=0;id<cars.length;id++){
    const a=cars[id],guided=sim.kind==='car'&&sim.guide&&guideIndex>=0;
    const time=(guided?sim.trafficClock:sim.world)-(guided?sim.trafficDelays[id]:0);
    let x,y,z,yaw,speed,visible=true;
    if(id<12){const k=Math.floor(id/2),east=id%2===0;speed=9.9+.31*k;
      const d=(42.3*k+time*speed+(east?4:19))%347;x=east?-173.5+d:173.5-d;y=east?33:37;z=2.595+6.84*clamp((150-Math.abs(x))/44,0,1);yaw=east?Math.PI/2:-Math.PI/2;
    }else{const i=id-12,north=i%4<2,east=i%2===1;speed=8.2+i%3*1.6;
      const d=(105*Math.floor(i/2)+time*speed)%1160;y=north?-425+d:735-d;x=(east?167:-161)+(north?2.2:-2.2);z=2.565;yaw=north?0:Math.PI;
      visible=!(y>21&&y<49||east&&y< -387||!east&&y< -377);}
    a.group.visible=visible;a.group.position.set(x,y,z);a.group.rotation.z=-yaw;
    for(const wheel of a.wheels)wheel.rotation.x=-(time*speed/meta.tyre)%(2*Math.PI);
  }
}
let streetPeople=[],walkerSlots=[],seaBirds,personClock={value:0};
function populateShore(){
  if(assets.pedestrian){
    const looks=['walkerMarina','walkerRunner','walkerLinen','walkerMarket','walkerCourier','walkerSkirt','walkerFisher','walkerCommuter','pedestrian'];
    for(let type=0;type<looks.length;type++){
    const source=assets[looks[type]]||assets.pedestrian;
    const ids=Array.from({length:33},(_,i)=>i).filter(i=>(i<15?i*5:i-15+(i>=24?3:0))%9===type);
    const walk=new Float32Array(ids.length*4);
    ids.forEach((i,k)=>{const n=i<15?i:i-15;walk.set([i<15?.91+.083*(n%5):.74+.085*(n%5),n*(i<15?1.48:.91),n,i<15?(n%4)/3:((n+2)%6)/5],k*4);walkerSlots[i]=[type,k];});
    const geometry=source.g.clone();geometry.setAttribute('walkPair',new T.InstancedBufferAttribute(walk,4));
    const materials=source.materials.map(mat=>{
      const m=mat.clone();
      m.customProgramCacheKey=()=>'paseantes-avenida';
      m.onBeforeCompile=shader=>{
        shader.uniforms.walkTime=personClock;
        shader.vertexShader='uniform float walkTime;attribute vec4 walkPair;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          float travel=walkTime*walkPair.x+.84*(sin(walkTime*.16+walkPair.z*1.81)-sin(walkPair.z*1.81));
          float phase=travel*6.2831853/(1.24+.035*mod(walkPair.z,5.))+walkPair.y;
          float alt=phase+(position.x<0.?3.14159265:0.);
          const float shoe[48]=float[48](0.000000,-0.002160,-0.003619,-0.002734,-0.000710,0.002365,0.006716,0.011614,0.015766,0.019645,0.022782,0.024817,0.025520,0.031075,0.036477,0.041495,0.045917,0.048994,0.043879,0.034476,0.025754,0.017579,0.010150,0.004794,0.000000,-0.002160,-0.003619,-0.002734,-0.000710,0.002365,0.006716,0.011614,0.015766,0.019645,0.022782,0.024817,0.025520,0.031075,0.036477,0.041495,0.045917,0.048994,0.043879,0.034476,0.025754,0.017579,0.010150,0.004794);
          float amt=0.,baseZ=0.;
          if(position.z<.94&&abs(position.x)<.222){amt=.41*sin(alt);baseZ=.92;if(position.z<.53){float b=-.63*max(0.,cos(alt));vec2 rel=transformed.yz-vec2(.015,.52);transformed.yz=vec2(cos(b)*rel.x-sin(b)*rel.y,sin(b)*rel.x+cos(b)*rel.y)+vec2(.015,.52);}}
          else if(abs(position.x)>.212&&position.z<1.42){amt=-.39*sin(alt);baseZ=1.34;}
          vec2 rel=transformed.yz-vec2(0.,baseZ);transformed.yz=vec2(cos(amt)*rel.x-sin(amt)*rel.y,sin(amt)*rel.x+cos(amt)*rel.y)+vec2(0.,baseZ);
          float hip=smoothstep(.57,.99,position.z),chest=smoothstep(.93,1.29,position.z),head=smoothstep(1.39,1.58,position.z);
          float glance=sin(walkTime*.43+3.8*walkPair.w),twist=sin(phase+.18)*(.061+.052*walkPair.w)*(1.1*chest-.38*hip-.42*head)+.18*sign(glance)*smoothstep(.73,1.,abs(glance))*head;
          transformed.xy=mat2(cos(twist),sin(twist),-sin(twist),cos(twist))*transformed.xy;transformed.x+=(.010+.014*walkPair.w)*sin(phase-.24)*hip;
          float stance=fract(phase/6.2831853)*48.;int stepIndex=int(stance);transformed.z-=mix(shoe[stepIndex],shoe[(stepIndex+1)%48],fract(stance));`);
      };return m;
    });
    const crowd=new T.InstancedMesh(geometry,materials,ids.length);crowd.frustumCulled=false;crowd.castShadow=crowd.receiveShadow=true;scene.add(crowd);streetPeople.push(crowd);
    }
  }
  if(assets.bird){seaBirds=new T.InstancedMesh(assets.bird.g,assets.bird.materials,12);seaBirds.frustumCulled=false;scene.add(seaBirds);}
}
function animateShore(){
  const actor=new T.Object3D(),time=sim.world;personClock.value=time;
  for(let i=0;i<walkerSlots.length;i++){
    let x,y,yaw,h;
    if(i<15){const north=i%2,speed=.91+.083*(i%5);const d=((north?i*66:1060-i*66)+time*speed+.84*(Math.sin(time*.16+i*1.81)-Math.sin(i*1.81)))%1060;
      x=i%3?172.6:-156.3;y=north?-290+d:770-d;yaw=north?0:Math.PI;h=.94+.02*(i%6);actor.position.z=2.55;
    }else{const k=i-15,r=.32,bend=Math.PI*r,offset=1.65*Math.sin(k*2.05)+.48*Math.cos(k*.71);const run=(k*18.53+offset+((k===10||k===14)?4.7:0)+time*(.74+.085*(k%5))+.84*(Math.sin(time*.16+k*1.81)-Math.sin(k*1.81)))%(128+2*bend);
      x=180;y=(k<9?597:531)+(k%3===1?-1:1)*(4.04+.19*(k%3));h=.91+.027*(k%7);actor.position.z=2.36;
      if(run<64){x+=run;y-=r;yaw=Math.PI/2;}else if(run<64+bend){const a=(run-64)/r;x+=64+r*Math.sin(a);y-=r*Math.cos(a);yaw=Math.PI/2-a;}
      else if(run<128+bend){x+=128+bend-run;y+=r;yaw=-Math.PI/2;}else{const a=(run-128-bend)/r;x-=r*Math.sin(a);y+=r*Math.cos(a);yaw=-Math.PI/2-a;}
    }
    actor.position.x=x;actor.position.y=y;actor.rotation.set(0,0,-yaw);actor.scale.setScalar(h);actor.updateMatrix();const [type,slot]=walkerSlots[i];streetPeople[type].setMatrixAt(slot,actor.matrix);
  }
  for(const crowd of streetPeople)crowd.instanceMatrix.needsUpdate=true;
  if(seaBirds){for(let i=0;i<12;i++){const a=time*.096+i*.38;actor.position.set(-52+Math.sin(a)*32+i*2.5,-263+i*62+Math.cos(a)*27,24+Math.sin(a)*3.5+i%4);
    actor.rotation.set(.071*Math.sin(time*4.1+i),.14*Math.cos(a),a-1.57);actor.scale.set(1.2,1.2,1+.32*Math.sin(time*4.5+i*1.7));actor.updateMatrix();seaBirds.setMatrixAt(i,actor.matrix);}seaBirds.instanceMatrix.needsUpdate=true;}
}
