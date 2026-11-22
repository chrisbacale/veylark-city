'use strict';
(() => {
const T=THREE, by=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), radians=Math.PI/180;
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),M=()=>new T.Matrix4(),Z=V(0,0,1),X=V(1,0,0), up=V(0,0,1);
const lerp=(a,b,t)=>a+(b-a)*t,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),ease=(k,d)=>1-Math.exp(-k*d);
const sim={kind:'title',p:V(-8,-525,22),yaw:.035,roll:0,pitch:0,speed:14,target:14,age:0,world:0,stage:0,guide:false,paused:false,detail:false,camera:0,head:0,headY:0,trip:0,odometer:0,notice:0,landed:false,driveNode:0,progress:0,groups:{},lastPad:0,roadAngle:0,steerRate:0,wheel:0,spin:0,climb:0,turn:0,hands:[],holding:-1,transfers:0,free:false,collisions:0};
const route=[[-8,-338,26,'Canal entrance'],[-20,-79,37,'Bay bridge'],[23,208,32,'Marina del Sol'],[36,474,42,'Palm promenade'],[123,708,32,'Miramar approach'],[155,790,13.6,'Miramar rooftop']];
const dispatch = globalThis.ViceCityDispatch;
if (dispatch) {
  dispatch.altitudeOffsets.forEach((offset, index) => {
    route[index][2] += offset;
    route[index][3] += ` · ${route[index][2]} m`;
  });
  by('intro').textContent = dispatch.briefing;
  by('mission-title').textContent = dispatch.title;
  by('mission-parameters').textContent = `${route.length - 1} checkpoints · ${formatClock(dispatch.timeLimit)} to land`;
  by('mission-title').hidden = false;
  by('mission-parameters').hidden = false;
}
const isDispatchFlight = () => Boolean(dispatch && sim.kind === 'air');
const timeLimit = () => isDispatchFlight() ? dispatch.timeLimit : 360;
function formatClock(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
const driveRoute=[[164.8,662,14],[164.8,605,9],[166,599,5],[171,595.6,7],[239,595.6,11],[247,593,5],[249.9,588,7],[249.9,542,10],[247.9,534,5],[241,532.3,7],[173,532.3,9],[166.5,529,5],[164.8,511,11],[164.8,240,14],[164.8,-235,14]];
let meta,rig,buffer,renderer,scene,cam,sun,water,assets={},model={},props=[],cars=[],boats=[],beacon,skyTexture,sourceMap,displays=[],keys=new Set(),lastT=0,fpsEstimate=45,frame=0,drag=null,muted=false,audio,engines,ambient,mix;
let viewWidth=0,viewHeight=0,resScale=1,shadowAge=0,lastHud=0,lastObjective='',bladePhase=0,t=0;
const touchPointers = new Map();
const canvas = by('world');
canvas.tabIndex = -1;
const usingTouch = () => matchMedia('(pointer: coarse), (max-width: 760px)').matches;
const movementKeys = new Set(['w', 'a', 's', 'd', ' ', 'control', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const climbControl = document.querySelector('[data-key=" "]');
const descendControl = document.querySelector('[data-key="control"]');
const brakeControl = document.querySelector('[data-key="s"]');

function pressed(key) {
  if (keys.has(key)) return true;
  for (const button of touchPointers.values()) if (button.dataset.key === key) return true;
  return false;
}

function clearInput() {
  keys.clear();
  for (const button of touchPointers.values()) delete button.dataset.held;
  touchPointers.clear();
  drag = null;
}

function updateTouchControls() {
  const driving = sim.kind === 'car';
  const climbLabel = driving ? 'Handbrake' : 'Climb';
  climbControl.firstChild.textContent = driving ? 'E-brake' : climbLabel;
  climbControl.lastElementChild.textContent = driving ? '■' : '↑';
  climbControl.setAttribute('aria-label', climbLabel);
  descendControl.hidden = driving;
  brakeControl.firstChild.textContent = driving ? 'Brake' : 'Throttle';
  brakeControl.setAttribute('aria-label', driving ? 'Brake or reverse' : 'Reduce throttle');
  by('touch-auto').setAttribute('aria-pressed', String(sim.guide));
  by('auto').textContent = sim.guide ? 'Turn assist off' : 'Turn assist on';
  by('touch-use').hidden = sim.kind === 'tesla';
  by('touch-use').textContent = driving ? 'Cockpit' : 'Land';
}
const reuseCam=V(),look=V();
const driverPose={value:new T.Vector2()};
/* ÓPTICA */
/* TRAYECTO */
/* SUPERFICIES */
/* SONIDO */
function say(s,seconds=4){by('notice').textContent=s;by('notice').hidden=!s;sim.notice=seconds;}
function noticeError(e){by('cover').hidden=false;by('loading').textContent='This game requires WebGL 2. Open it in a browser with hardware acceleration enabled. '+(e?.message||'');by('cover-actions').hidden=true;}
function typed(key,format){const [off,n]=key;return new format(buffer,off,n);}
function half(bits){const s=bits&32768?-1:1,e=(bits>>>10)&31,m=bits&1023;return s*(e?(1+m/1024)*2**(e-15):m*2**-24);}
function decodedHalf(info){const data=typed(info,Uint16Array),out=new Float32Array(data.length);for(let i=0;i<out.length;i++)out[i]=half(data[i]);return out;}
function translate(p){return M().makeTranslation(p.x,p.y,p.z);}
function rotation(center,axis,a){return translate(center).multiply(M().makeRotationAxis(axis,a)).multiply(M().makeTranslation(-center.x,-center.y,-center.z));}
function setMatrix(obj,mat){obj.matrixAutoUpdate=false;obj.matrix.copy(mat);obj.matrixWorldNeedsUpdate=true;}
function followDriverGaze(material){
  material.customProgramCacheKey=()=>'atlante-driver-pose';
  material.onBeforeCompile=sh=>{
    sh.uniforms.driverPose=driverPose;
    sh.vertexShader='uniform vec2 driverPose;\nvec3 vcGaze(vec3 q,vec2 a){vec2 c=cos(a),s=sin(a);q.yz=vec2(q.y*c.y-q.z*s.y,q.y*s.y+q.z*c.y);q.xy=vec2(q.x*c.x+q.y*s.x,-q.x*s.x+q.y*c.x);return q;}\n'+sh.vertexShader;
    sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 pivot=vec3(-.37,-.319,1.120);transformed=pivot+vcGaze(transformed-pivot,driverPose*smoothstep(1.097,1.181,position.z));');
    sh.vertexShader=sh.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=vcGaze(objectNormal,driverPose*smoothstep(1.097,1.181,position.z));');
  };
}
function shaderMaterial(id,name,hand){
  const paint=id===16,glass=id===15||id===19,metal=[6,18,30,36].includes(id),light=[7,8,13].includes(id);
  const physical=paint||glass;
  const options={vertexColors:true,side:T.DoubleSide,roughness:paint?.24:glass?.09:metal?.32:id===12?.83:id===25?.36:[24,34].includes(id)?.57:[26,33].includes(id)?.86:id===27?.49:.74,metalness:paint?.52:metal?.79:0,envMapIntensity:paint?1.02:glass?1.08:metal?.76:.31};
  if(id===38)options.roughness=.53;
  if(id===39)options.roughness=.40;
  if(glass)Object.assign(options,{transparent:true,opacity:id===15?.21:.30,depthWrite:false});
  if(physical)Object.assign(options,{clearcoat:glass?.84:1,clearcoatRoughness:paint?.115:.065});
  const mat=light?new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide}):physical?new T.MeshPhysicalMaterial(options):new T.MeshStandardMaterial(options);
  const city=name==='city',field=city&&[0,1,2,3,4,5,6,9,10,11].includes(id),skin=!!hand;
  if(skin||field||paint||light){
    mat.customProgramCacheKey=()=>`vice-${id}-${Number(field)}-${Number(skin)}`;
    mat.onBeforeCompile=sh=>{
      sh.vertexShader='varying vec3 vcLocal;varying vec3 vcRestN;\n'+(skin?'attribute vec3 openP;attribute vec3 openN;attribute float digitPhase;uniform float releaseHand;\n':'')+sh.vertexShader;
      sh.vertexShader=sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvcLocal=position;vcRestN=normal;'+(skin?'\ntransformed+=openP*(releaseHand+digitPhase*4.*releaseHand*(1.-releaseHand));':''));
      if(skin){sh.uniforms.releaseHand=hand;sh.vertexShader=sh.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=normalize(objectNormal+openN*(releaseHand+digitPhase*4.*releaseHand*(1.-releaseHand)));');}
      let fragment='';
      if(city&&(id===1||id===2))fragment=`if(abs(vcRestN.z)<.72){vec2 wall=vec2(abs(vcRestN.x)>abs(vcRestN.y)?vcLocal.y:vcLocal.x,vcLocal.z);vec2 g=wall/vec2(${id===1?'2.04':'2.63'},3.27);vec2 s=fract(g),ed=min(s,1.-s),aa=max(fwidth(g),.001);float win=smoothstep(.047-aa.x,.047+aa.x,ed.x)*smoothstep(.095-aa.y,.095+aa.y,ed.y);float tenant=fract(sin(dot(floor(g),vec2(165.7,23.1)))*1423.8);vec3 room=mix(vec3(.041,.093,.126),vec3(.56,.31,.13),smoothstep(.79,.90,tenant));float coffer=smoothstep(.32,.59,abs(s.x-.53));diffuseColor.rgb=mix(diffuseColor.rgb,room*(.78+.22*coffer),.81*win);}`;
      if(id===3&&city)fragment='float paving=.5+.5*sin(vcLocal.x*.14+sin(vcLocal.y*.071))*sin(vcLocal.y*.19);diffuseColor.rgb*=.87+.21*paving;';
      if(light)fragment='diffuseColor.rgb*=1.65;';
      if(skin&&(id===24||id===34))fragment='float blot=sin(vcLocal.y*171.+sin(vcLocal.z*94.))*sin(vcLocal.z*223.);diffuseColor.rgb*=vec3(1.+.035*blot,1.-.009*blot,1.-.021*blot);';
      sh.fragmentShader='varying vec3 vcLocal;varying vec3 vcRestN;\n'+sh.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+fragment);
      if(field)cityFinish(sh,id);
    };
  }
  return mat;
}
function readModel(name,record){
  const g=new T.BufferGeometry();let pos;
  if(record.quant){const q=typed(record.pos,Uint16Array);pos=new Float32Array(q.length);for(let i=0;i<q.length;i++)pos[i]=record.low[i%3]+record.span[i%3]*q[i]/65535;}
  else pos=typed(record.pos,Float32Array);
  g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('normal',new T.BufferAttribute(typed(record.norm,Int8Array),3,true));g.setAttribute('color',new T.BufferAttribute(typed(record.rgb,Uint8Array),3,true));
  if(record.uv)g.setAttribute('uv',new T.BufferAttribute(decodedHalf(record.uv),2));
  const release=record.release?{value:0}:null;
  if(release){const a=decodedHalf(record.release),p=new Float32Array(a.length/2),n=new Float32Array(a.length/2);for(let j=0;j<p.length;j++){const k=Math.floor(j/3)*6+j%3;p[j]=a[k];n[j]=a[k+3];}g.setAttribute('openP',new T.BufferAttribute(p,3));g.setAttribute('openN',new T.BufferAttribute(n,3));g.setAttribute('digitPhase',new T.BufferAttribute(typed(record.phase,Int16Array),1,true));}
  g.setIndex(new T.BufferAttribute(typed(record.idx,record.wide?Uint32Array:Uint16Array),1));
  const materials=record.groups.map(([start,length,id],j)=>{g.addGroup(start,length,j);return shaderMaterial(id,name,release);});
  g.computeBoundingSphere();const mesh=new T.Mesh(g,materials);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;
  if(name==='coupeDriver'){materials.forEach(followDriverGaze);mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});followDriverGaze(mesh.customDepthMaterial);}
  assets[name]={mesh,g,materials,release};return mesh;
}
function setScreen(mesh,index,texture){if(!mesh||index<0)return;mesh.material[index]=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,toneMapped:false});}
function dashboard(name){const mesh=assets[name]?.mesh;if(!mesh)return;const cn=document.createElement('canvas');cn.width=512;cn.height=192;const texture=new T.CanvasTexture(cn);texture.flipY=false;texture.colorSpace=T.SRGBColorSpace;setScreen(mesh,0,texture);displays.push({cn,texture,type:name});}
function displayRefresh(){for(const d of displays){const c=d.cn.getContext('2d');c.fillStyle='#06161c';c.fillRect(0,0,512,192);c.strokeStyle='#436169';c.lineWidth=2;c.strokeRect(5,5,502,182);c.fillStyle='#8eaeaa';c.font='18px sans-serif';c.fillText(d.type==='carLCD'?'COAST ROAD  /  ATLANTE':'MIRAMAR   /   09',22,30);c.fillStyle='#bdf4df';c.font='66px monospace';c.fillText(String(Math.round(Math.abs(sim.speed*3.6))).padStart(3,'0'),33,117);c.font='18px sans-serif';c.fillText('KM/H',40,152);c.fillStyle='#edb67e';c.fillText(d.type==='carLCD'?(sim.guide?'AUTO':'MANUAL'):'ALT  '+Math.round(sim.p.z)+' M',302,105);d.texture.needsUpdate=true;}}
function instanceProps(){
  const plants=meta.plants.filter(p=>p[0]<.5);const pmesh=assets.palmMid||assets.palmFar;
  if(pmesh&&plants.length){const palms=new T.InstancedMesh(pmesh.g,pmesh.materials,plants.length);const obj=new T.Object3D();plants.forEach((p,i)=>{obj.position.set(p[1],p[2],p[3]);obj.rotation.z=p[5];obj.scale.setScalar(p[4]*.1);obj.updateMatrix();palms.setMatrixAt(i,obj.matrix);});palms.receiveShadow=true;palms.castShadow=true;scene.add(palms);}
  for(let i=0;i<38;i++){const group=new T.Group(),body=assets.car.mesh.clone();body.material=assets.car.materials.map((m,j)=>{if(meta.meshes.car.groups[j][2]!==16)return m;const c=m.clone();c.color.set([0xcee2de,0xc9674f,0x61979c,0x91a85e,0x9399bc,0xd7aa69][i%6]);return c;});group.add(body);let wheels=[];for(let j=0;j<4;j++){const mesh=assets['npcWheel'+['FL','FR','RL','RR'][j]]?.mesh.clone();if(mesh){mesh.position.fromArray(meta.wheels[j]);wheels.push(mesh);group.add(mesh);}}scene.add(group);cars.push({group,wheels});}
  if(assets.boat)for(let j=0;j<5;j++){const ob=assets.boat.mesh.clone();scene.add(ob);boats.push(ob);}
}
function makeWorld(){
  T.Object3D.DEFAULT_UP.set(0,0,1);scene=new T.Scene();cam=new T.PerspectiveCamera(61,1,.12,6500);cam.up.copy(up);
  renderer=new T.WebGLRenderer({canvas:by('world'),antialias:true,alpha:false,powerPreference:'high-performance'});renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  skyTexture=new T.DataTexture(typed(meta.sky,Uint16Array),...meta.skySize,T.RGBAFormat,T.HalfFloatType);skyTexture.mapping=T.EquirectangularReflectionMapping;skyTexture.colorSpace=T.LinearSRGBColorSpace;skyTexture.magFilter=T.LinearFilter;skyTexture.minFilter=T.LinearFilter;skyTexture.needsUpdate=true;
  scene.background=skyTexture;const pmrem=new T.PMREMGenerator(renderer);scene.environment=pmrem.fromEquirectangular(skyTexture).texture;pmrem.dispose();scene.backgroundIntensity=1.0;scene.environmentIntensity=.90;scene.fog=new T.FogExp2(0xd1ae9a,.00047);
  const hemi=new T.HemisphereLight(0xd1e0fb,0x657176,1.35);hemi.position.set(0,0,1);scene.add(hemi);
  sun=new T.DirectionalLight(0xffd3a8,2.65);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-58,right:58,top:58,bottom:-58,near:1,far:235});sun.shadow.bias=-.0002;sun.shadow.normalBias=.045;scene.add(sun,sun.target);
  loadCityTextures();Object.entries(meta.meshes).forEach(([n,g])=>readModel(n,g));scene.add(assets.city.mesh);model.air=new T.Group();model.car=new T.Group();model.road=new T.Group();scene.add(model.air,model.car,model.road);
  if(assets.roadsterAirframe){model.road.add(assets.roadsterAirframe.mesh);wheelIds.forEach((id,k)=>{const fan=assets['roadsterRotor'+id]?.mesh;if(fan){fan.position.fromArray(rotorPivots[k]);model.road.add(fan);}});}
  for(const n of ['craft','cockpit','rotorL','rotorR','cyclicR','powerL','display','landingGear'])if(assets[n])model.air.add(assets[n].mesh);
  for(const [j,n] of ['rotorL','rotorR'].entries())if(assets[n])assets[n].mesh.position.fromArray(meta.rotors[j]);
  for(const n of ['cyclicR','powerL'])if(assets[n])assets[n].mesh.position.fromArray(meta.flightControls[n]);
  for(const n of ['carBody','coupeDriver','carLCD','rearView','wheelFL','wheelFR','wheelRL','wheelRR','steerWheel','steerHandL','steerHandR','steerUpperL','steerUpperR','steerForeL','steerForeR'])if(assets[n])model.car.add(assets[n].mesh);
  dashboard('carLCD');dashboard('display');sourceMap=new T.DataTexture(typed(meta.map,Uint8Array),512,512,T.RGBAFormat);sourceMap.colorSpace=T.SRGBColorSpace;sourceMap.needsUpdate=true;sourceMap.minFilter=T.LinearFilter;sourceMap.magFilter=T.LinearFilter;
  prepareOptics();water=coastalWater();water.position.z=-.07;scene.add(water);
  instanceProps();populateShore();beacon=new T.Mesh(new T.TorusGeometry(4.1,.14,7,60),new T.MeshBasicMaterial({color:0xffc789,transparent:true,opacity:.78}));scene.add(beacon);
}
function resetHands(){sim.hands=[0,1].map(()=>({angle:0,open:0,clear:0,progress:1,start:0,dest:0,duration:.55,initialRate:0}));sim.holding=-1;sim.wheel=0;sim.steerRate=0;}
function smoothphase(x,a,b){x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x);}
function column(angleRequest,dt){
  const h=sim.hands,desired=angleRequest*(13.1-3.8*Math.abs(angleRequest)),err=desired-sim.wheel;
  const want=clamp(err*10,-3.9,3.9);sim.steerRate+=clamp(want-sim.steerRate,-21*dt,21*dt);
  const reach=(j,to,duration)=>{const f=h[j];f.progress=0;f.start=f.angle;f.dest=to;f.initialRate=sim.steerRate;f.duration=duration;sim.holding=j;sim.transfers++;};
  if(sim.holding<0){if(Math.abs(err)>.0005&&Math.abs(want)>.005){const dir=Math.sign(want),first=dir>0?1:0,j=h[first].angle*dir>=h[1-first].angle*dir-.012?first:1-first,at=h[j].angle*dir;if((at>(Math.abs(err)>1.8?.20:.42)&&at+Math.abs(err)>.86&&Math.abs(err)>.08)||at>1.075)reach(j,-dir*.68,.55);}
    else if(Math.abs(sim.wheel)<.045&&Math.abs(sim.steerRate)<.09){const j=Math.abs(h[0].angle)>.075?0:Math.abs(h[1].angle)>.075?1:-1;if(j>=0)reach(j,0,.49);}}
  if(sim.holding>=0){const cap=Math.sqrt(Math.max(0,26*(1.09-Math.sign(sim.steerRate)*h[1-sim.holding].angle)));sim.steerRate=clamp(sim.steerRate,-cap,cap);}
  let step=sim.steerRate*dt;if(step*err>0&&Math.abs(step)>=Math.abs(err))step=err;
  h.forEach((f,j)=>{if(j===sim.holding&&f.progress>.18&&f.progress<.78)return;const room=step>=0?1.09-f.angle:1.09+f.angle;step=Math.sign(step)*Math.min(Math.abs(step),Math.max(0,room));});sim.steerRate=step/dt;sim.wheel+=step;
  h.forEach((f,j)=>{if(j!==sim.holding){f.angle+=step;f.open=f.clear=0;return;}const before=f.progress,p=f.progress=Math.min(1,f.progress+dt/f.duration),soft=Math.sin(Math.PI*smoothphase(p,.29,.73));
    f.open=smoothphase(p,0,.16)*(1-smoothphase(p,.83,1))*(1-(.11+.047*Math.min(1,Math.abs(f.dest-f.start)))*soft*soft);
    f.clear=smoothphase(p,.16,.29)*(1-smoothphase(p,.62,.92));if(p<=.24){f.angle+=step;f.start=f.angle;f.initialRate=step/dt;}
    else if(p<.76){const q=clamp((p-.24)/.52,0,1),dur=.52*f.duration;f.angle=f.start+(f.dest-f.start)*q*q*(3-2*q)+q*(1-q)*(1-q)*clamp(f.initialRate*dur,-.29,.29)-q*q*(1-q)*clamp(sim.steerRate*dur,-.29,.29);}
    else f.angle=before<.76?f.dest:f.angle+step;if(p>=1){sim.holding=-1;f.open=f.clear=0;}});
  return Math.sign(sim.wheel)*2*Math.abs(sim.wheel)/(13.1+Math.sqrt(Math.max(1,13.1*13.1-15.2*Math.abs(sim.wheel))));
}
function bone(a,b,c,d,twist){const u=b.clone().sub(a).normalize(),v=d.clone().sub(c).normalize(),q=new T.Quaternion().setFromUnitVectors(u,v);return translate(c).multiply(M().makeRotationAxis(v,twist)).multiply(M().makeRotationFromQuaternion(q)).multiply(M().makeTranslation(-a.x,-a.y,-a.z));}
function handRig(){
  const center=V(...rig.wheel_center),axis=V(...rig.wheel_axis).normalize();setMatrix(assets.steerWheel.mesh,rotation(center,axis,-sim.wheel));
  sim.hands.forEach((f,j)=>{const s=j?'r':'l',n=s.toUpperCase(),grip=V(...rig['grip_'+s]),w=V(...rig['wrist_'+s]),e=V(...rig['elbow_'+s]),a=V(...rig['shoulder_'+s]);const rot=rotation(center,axis,-f.angle),rad=grip.clone().applyMatrix4(rot).sub(center).normalize();const lift=rad.clone().multiplyScalar(.024*f.clear).addScaledVector(axis,.008*f.clear);const hand=translate(lift).multiply(rot);
    if(f.clear>.22){
      const up=axis.clone().cross(X).normalize(),height=.5+.5*rad.dot(up),amount=smoothphase(f.clear,.22,1)*Math.PI/180;
      hand.multiply(rotation(w,X,(10+11*height)*amount)).multiply(rotation(w,up,(j?1:-1)*(6-2*height)*amount));
    }
    setMatrix(assets['steerHand'+n].mesh,hand);assets['steerHand'+n].release.value=f.open;
    const wr=w.clone().applyMatrix4(hand),along=wr.clone().sub(a).normalize(),l1=e.distanceTo(a),l2=w.distanceTo(e),length=wr.distanceTo(a),off=clamp(length-l1-l2+.005,0,.033),shoulder=a.clone().addScaledVector(along,off),dist=Math.max(.001,length-off),station=clamp((l1*l1-l2*l2+dist*dist)/(2*dist),-.99*l1,l1);
    const rest=w.clone().sub(a).normalize(),pole=e.clone().sub(a);pole.addScaledVector(rest,-pole.dot(rest));pole.addScaledVector(along,-pole.dot(along)).normalize();const elbow=shoulder.clone().addScaledVector(along,station).addScaledVector(pole,Math.sqrt(Math.max(0,l1*l1-station*station)));
    setMatrix(assets['steerUpper'+n].mesh,bone(a,e,shoulder,elbow,.1*f.angle));const fa=wr.clone().sub(elbow).normalize();const original=X.clone().transformDirection(bone(e,w,elbow,wr,0)),current=X.clone().transformDirection(hand);
    original.addScaledVector(fa,-fa.dot(original)).normalize();current.addScaledVector(fa,-fa.dot(current)).normalize();const twist=Math.atan2(fa.dot(original.clone().cross(current)),clamp(original.dot(current),-1,1));setMatrix(assets['steerFore'+n].mesh,bone(e,w,elbow,wr,twist*.79));});
}
function roadAt(x,y,fallback){let z=null;for(const a of meta.roads){if(x<Math.min(a[0],a[3],a[6])-.05||x>Math.max(a[0],a[3],a[6])+.05||y<Math.min(a[1],a[4],a[7])-.05||y>Math.max(a[1],a[4],a[7])+.05)continue;let u=(a[4]-a[7])*(a[0]-a[6])+(a[6]-a[3])*(a[1]-a[7]);if(Math.abs(u)<1e-7)continue;const p=((a[4]-a[7])*(x-a[6])+(a[6]-a[3])*(y-a[7]))/u,q=((a[7]-a[1])*(x-a[6])+(a[0]-a[6])*(y-a[7]))/u;if(p<-.002||q<-.002||p+q>1.002)continue;const t=p*a[2]+q*a[5]+(1-p-q)*a[8];if(z===null||Math.abs(t-fallback)<Math.abs(z-fallback))z=t;}return z;}
function obstacle(x,y,z,car){const half=car?.70:1.25;for(const b of meta.boxes){if(x+half>b[0]&&x-half<b[3]&&y+half>b[1]&&y-half<b[4]&&z+(car?1.18:.46)>b[2]&&z+(car?.25:-.38)<b[5])return true;}return false;}
function start(kind,guided=false){if(sim.kind==='title'||journey.ended)newJourney();clearInput();startAudio();
  sim.coastLeg=0;sim.settling=false;sim.contact=0;sim.thrust=1;sim.bankRate=sim.pitchRate=0;sim.trafficDelays=new Float32Array(38);sim.trafficClock=sim.world;guideIndex=-1;
  sim.heave=sim.heaveRate=0;sim.contactHeight=new Float32Array(4);
  for(const id of ['resume','change','change-tesla','auto','mute'])by(id).hidden=false;by('return').textContent='Main menu';
  previousSite.set(1e6,1e6,1e6);lastMirror=-2;sim.kind=kind;sim.guide=guided;sim.paused=false;sim.detail=false;sim.head=sim.headY=0;sim.age=0;sim.stage=0;sim.driveNode=0;sim.landed=false;sim.free=false;sim.trip=0;sim.odometer=0;sim.collisions=0;sim.roll=sim.pitch=sim.turn=sim.climb=sim.spin=0;resetHands();
  const car=kind==='car';sim.p.set(...(car?[164.8,714,2.56]:kind==='tesla'?[-22,-278,1.65]:[-8,-525,22]));sim.yaw=car?Math.PI:kind==='tesla'?-.205:.035;sim.speed=sim.target=car?0:kind==='tesla'?5.2:14;sim.vx=Math.sin(sim.yaw)*sim.speed;sim.vy=Math.cos(sim.yaw)*sim.speed;sim.camera=car?1:kind==='tesla'?2:0;resetWake();if(car&&guided)guideIndex=0;model.car.visible=true;model.air.visible=true;by('cover').hidden=true;by('pause').hidden=true;by('hud').hidden=false;by('hud').inert=false;updateTouchControls();canvas.focus({preventScroll:true});tickModels();refreshHud();const touch=usingTouch();say(touch?(car?'Use Left and Right to steer. Hold Throttle to accelerate.':'Match the checkpoint altitude with Climb and Descend.'):(car?'W / S accelerate and brake  ·  A / D steer':'W / S throttle  ·  A / D steer  ·  Space climb  ·  Ctrl descend'),6);}
function use(){if(sim.kind==='car'){sim.detail=!sim.detail;sim.camera=1;sim.head=sim.headY=0;return;}if(sim.landed){start('car',sim.guide);return;}if(sim.kind==='air'&&sim.stage===5&&sim.p.distanceTo(V(...route[5].slice(0,3)))<16&&sim.speed<6&&sim.p.z<19)deliver();}
function deliver(){if(!sim.landed)sim.settling=true;}
const controlHelp = {
  car: {
    keyboard: 'W / S accelerate and brake. A / D steer. Space applies the handbrake. C changes camera. B switches to the cockpit. Drag to look around.',
    touch: 'Hold throttle or brake and steer left or right. Hold E-brake for a sharp stop. Tap Cockpit to change view or drag the scene to look around.'
  },
  tesla: {
    keyboard: 'Use W and S for throttle and A and D to steer. Press Space to climb, Ctrl to descend and C to change camera.',
    touch: 'Hold throttle, steer and adjust your altitude. Drag the scene to look around and tap Camera to change view.'
  },
  air: {
    keyboard: 'Use W and S for throttle and A and D to steer. Press Space to climb and Ctrl to descend. Slow down over the rooftop and press E to land.',
    touch: 'Steer through each checkpoint at its target altitude. Slow down over the rooftop, then tap Land.'
  }
};

function pause() {
  if (sim.kind === 'title' || journey.ended) return;
  sim.paused = !sim.paused;
  clearInput();
  by('pause').hidden = !sim.paused;
  by('hud').inert = sim.paused;
  if (sim.paused) {
    by('pause-title').textContent = sim.landed ? 'Delivery Complete' : 'Paused';
    by('controls').textContent = controlHelp[sim.kind][usingTouch() ? 'touch' : 'keyboard'];
    by('resume').focus({ preventScroll: true });
  } else {
    canvas.focus({ preventScroll: true });
  }
  if (audio) mix.gain.setTargetAtTime(sim.paused || muted ? 0 : .20, audio.currentTime, .08);
}

function playerInput(){let turn=Number(pressed('d')||pressed('arrowright'))-Number(pressed('a')||pressed('arrowleft')),power=Number(pressed('w')||pressed('arrowup'))-Number(pressed('s')||pressed('arrowdown')),lift=Number(pressed(' '))-Number(pressed('control'));let pad;
  try{pad=navigator.getGamepads?.()[0];}catch{}
  if(pad){const axis=s=>Math.abs(s||0)>.17?s:0;turn=clamp(turn+axis(pad.axes[0]),-1,1);power=clamp(power+(pad.buttons[7]?.value||0)-(pad.buttons[6]?.value||0),-1,1);lift=clamp(lift-axis(pad.axes[1]),-1,1);sim.head=clamp(sim.head+axis(pad.axes[2])*.012,-1.2,1.2);const mask=pad.buttons.reduce((m,b,i)=>b.pressed?m|(1<<i):m,0),pressed=mask&~sim.lastPad;sim.lastPad=mask;if(pressed&1)use();if(pressed&2&&sim.kind==='car')use();if(pressed&4)start(sim.kind==='car'?'air':'car');if(pressed&8)nextCamera();if(pressed&4096)start('tesla');if(pressed&512)pause();}
  return [turn,power,lift];}
function practice(dt){if(sim.kind==='title'||sim.paused||!trackClock(dt))return;sim.age+=dt;sim.trip+=dt;sim.world+=dt;sim.notice-=dt;if(sim.notice<=0)by('notice').hidden=true;let [turn,power,lift]=playerInput();if(sim.paused)return;
  const p=sim.p,previous=p.clone();let xx,yy;
  if(sim.kind==='tesla'){roadsterFlight(dt,turn,power,lift);return;}
  if(sim.kind==='air'){
    if(sim.landed){sim.progress+=dt;if(sim.guide&&sim.progress>4)start('car',true);return;}
    const goal=route[sim.stage];const range=Math.hypot(p.x-goal[0],p.y-goal[1]);
    if(sim.guide){const err=wrap(Math.atan2(goal[0]-p.x,goal[1]-p.y)-sim.yaw);turn=clamp(err*1.78,-1,1);sim.target=sim.stage===5?clamp(range*.24,0,14):20;lift=clamp((goal[2]-p.z)*.25,-1,1);}
    else sim.target=clamp(sim.target+power*dt*7.8,0,35);
    if(sim.settling){sim.target=0;turn=power=0;lift=clamp((13.51-p.z)*.30-sim.climb*.15,-.20,0);}
    sim.speed=lerp(sim.speed,sim.target,ease(1.6,dt));sim.turn=lerp(sim.turn,turn*(.41+sim.speed*.0095),ease(2.6,dt));sim.yaw+=sim.turn*dt;sim.climb=lerp(sim.climb,lift*6.1,ease(2.3,dt));sim.roll=lerp(sim.roll,-sim.turn*.40,ease(3.8,dt));sim.pitch=lerp(sim.pitch,power*.055+sim.climb*.01,ease(3.2,dt));
    xx=p.x+Math.sin(sim.yaw)*sim.speed*dt;yy=p.y+Math.cos(sim.yaw)*sim.speed*dt;let floor=Math.hypot(xx-155,yy-790)<15?13.55:3;
    const zz=clamp(p.z+dt*sim.climb,floor,162);if(!obstacle(xx,yy,zz,false)||Math.hypot(xx-155,yy-790)<14){p.set(clamp(xx,-420,450),clamp(yy,-845,1180),zz);}else{sim.speed*=.92;p.z=clamp(p.z+dt*4,3,160);}
    journey.metres+=p.distanceTo(previous);if(sim.stage<5&&range<42&&Math.abs(p.z-goal[2])<(isDispatchFlight()?7:18)){sim.stage++;journey.points=Math.max(journey.points,sim.stage);say(route[sim.stage][3],2.2);}else if(sim.stage===5&&sim.guide&&range<7&&p.z<17&&sim.speed<5.5)deliver();
    if(sim.settling&&p.z<13.57&&sim.speed<.18){sim.contact+=dt;if(sim.contact>.4){sim.landed=true;sim.speed=sim.target=sim.climb=0;sim.progress=0;journey.points=6;if(isDispatchFlight())completeJourney(true);else say(usingTouch()?'Delivery complete. Tap Land to switch to driving.':'Delivery complete. Press E to switch to driving.',8);}}
  }else{
    if(sim.guide&&followRoad(dt))return;
    const goal=driveRoute[sim.driveNode];const range=Math.hypot(p.x-goal[0],p.y-goal[1]);
    if(range<Math.max(5,sim.speed*.6)&&sim.driveNode<driveRoute.length-1)sim.driveNode++;
    if(sim.guide){const goal=driveRoute[sim.driveNode];let err=wrap(Math.atan2(goal[0]-p.x,goal[1]-p.y)-sim.yaw);turn=clamp(err*2.65,-1,1);let target=sim.driveNode===driveRoute.length-1&&range<8?0:goal[2]/(1+Math.min(2.4,Math.abs(err)*1.8));for(const actor of cars){let dx=actor.group.position.x-p.x,dy=actor.group.position.y-p.y,along=dx*Math.sin(sim.yaw)+dy*Math.cos(sim.yaw),across=Math.abs(dx*Math.cos(sim.yaw)-dy*Math.sin(sim.yaw));if(along>0&&along<19&&across<1.65)target=Math.min(target,Math.max(0,along-5));}power=clamp((target-sim.speed)*.86,-1,1);}
    const previousSpeed=sim.speed;let acc=power>=0?power*(sim.speed<0?11.2:5.4):power*(sim.speed>.2?11.7:3.2);if(Math.abs(sim.speed)>.08)acc-=Math.sign(sim.speed)*(.3+.0038*sim.speed*sim.speed);if(lift>.5)sim.speed=Math.sign(sim.speed)*Math.max(0,Math.abs(sim.speed)-dt*12.5);else sim.speed=clamp(sim.speed+acc*dt,-6.2,34);
    const road=column(turn*(.59-.27*clamp(Math.abs(sim.speed)/25,0,1)),dt);sim.roadAngle=road;sim.turn=Math.tan(road)*sim.speed/2.72;sim.yaw+=sim.turn*dt;xx=p.x+Math.sin(sim.yaw)*sim.speed*dt;yy=p.y+Math.cos(sim.yaw)*sim.speed*dt;const height=roadAt(xx,yy,p.z);
    let blocked=height===null||Math.abs(height-p.z)>.8||obstacle(xx,yy,height+.02,true);if(!blocked)for(const actor of cars){if(!actor.group.visible||Math.abs(actor.group.position.z-p.z)>1.7)continue;const dx=actor.group.position.x-xx,dy=actor.group.position.y-yy;if(Math.abs(dx*Math.sin(sim.yaw)+dy*Math.cos(sim.yaw))<3.68&&Math.abs(dx*Math.cos(sim.yaw)-dy*Math.sin(sim.yaw))<1.48){blocked=true;break;}}
    if(!blocked){p.set(xx,yy,height+.018);sim.odometer+=Math.abs(sim.speed*dt);journey.metres+=Math.abs(sim.speed*dt);}else if(Math.abs(sim.speed)>1){sim.speed*=.84;sim.yaw-=sim.turn*dt;}
    sprungRoad(dt,dt>0?(sim.speed-previousSpeed)/dt:0,false);sim.spin=(sim.spin+sim.speed*dt/meta.tyre)%(2*Math.PI);
    if(!sim.free&&p.y< -224&&Math.abs(p.x-165)<24){sim.free=true;journey.beach=true;sim.guide=false;say(usingTouch()?'Waterfront reached. The Roadster is available from Pause.':'Waterfront reached. Press T to switch to the Roadster.',7);}
  }
}
function trafficStep(){roadTraffic();animateShore();boats.forEach((a,i)=>{const flip=i%2?-1:1;a.position.set(-76+i*31+2*Math.sin(sim.world*.04+i),flip*((i*184+sim.world*(4.5+i*.45))%1410)+(flip===1?-515:895),.16*Math.sin(sim.world*.9+i));a.rotation.set(.02*Math.sin(sim.world+i),.035*Math.sin(sim.world*.83+i),flip===1?0:Math.PI,'ZXY');});}
function tickModels(){
  const car=sim.kind==='car',tesla=sim.kind==='tesla',seat=sim.camera===1,airInside=sim.kind==='air'&&seat&&!sim.landed,parked=car||tesla;
  model.air.position.copy(parked?V(155,790,13.55):sim.p);model.air.rotation.set(parked?0:-sim.pitch,parked?0:-sim.roll,parked?0:-sim.yaw,'ZXY');
  model.road.visible=tesla;if(tesla){model.road.position.copy(sim.p);model.road.rotation.set(-sim.pitch,-sim.roll,-sim.yaw,'ZXY');wheelIds.forEach((id,k)=>{const fan=assets['roadsterRotor'+id]?.mesh;if(fan)fan.rotation.z=sim.world*(k===1||k===2?-1:1)*(87+16*sim.thrust);});}
  assets.craft.mesh.visible=!airInside;['cockpit','cyclicR','powerL','display'].forEach(n=>{if(assets[n])assets[n].mesh.visible=airInside;});
  if(assets.landingGear){const gear=assets.landingGear.mesh,p=model.air.position;gear.visible=!airInside;const gap=Math.hypot(p.x-155,p.y-790)<13.5?p.z-13:1;gear.scale.z=1-clamp((.626-gap)/.626,0,.15);}
  for(let j=0;j<2;j++){const obj=assets[j?'rotorR':'rotorL'];if(obj)obj.mesh.rotation.z=bladePhase*(j?1:-1);}
  if(airInside){assets.cyclicR.mesh.rotation.set(sim.climb*.024,sim.turn*.27,0);assets.powerL.mesh.rotation.x=(16-36*clamp(sim.target/32,0,1))*radians;}
  model.car.position.copy(car?sim.p:V(164.8,714,2.56));model.car.rotation.set(car?sim.pitch:0,car?sim.roll:0,car?-sim.yaw:0,'ZXY');
  if(assets.coupeDriver){assets.coupeDriver.mesh.visible=car&&!seat;const yawRate=Math.tan(sim.roadAngle)*sim.speed/2.72;driverPose.value.set(clamp(sim.roadAngle*.37+yawRate*.12,-.19,.19),-sim.pitch*.42+.0035*Math.sin(sim.world*1.61));}
  if(car)model.car.position.z+=sim.heave;
  for(const [j,n] of ['wheelFL','wheelFR','wheelRL','wheelRR'].entries())if(assets[n]){const w=assets[n].mesh;w.position.fromArray(meta.wheels[j]);
    if(car){const wheelHeight=w.position.clone().applyQuaternion(model.car.quaternion).z+sim.heave;w.position.z+=clamp(meta.wheels[j][2]+sim.contactHeight[j]-wheelHeight,-.105,.105);}
    w.rotation.set(-sim.spin,0,j<2?-sim.roadAngle:0,'ZXY');}
  if(car)handRig();const cp=assets.carBody;const idx=meta.meshes.carBody.groups.findIndex(x=>x[2]===19);if(idx>=0)cp.materials[idx].visible=!(car&&seat);
  if(sim.kind==='air'&&!sim.landed){const q=route[sim.stage];beacon.position.set(q[0],q[1],q[2]);beacon.quaternion.copy(cam.quaternion);beacon.visible=true;beacon.scale.setScalar(sim.stage===5?.72:1);}
  else if(car&&!sim.free){const q=driveRoute[sim.driveNode];beacon.position.set(q[0],q[1],2.95);beacon.rotation.set(0,0,0);beacon.scale.set(.55,.55,.55);beacon.visible=true;}else beacon.visible=false;
}
function placeCamera(){const car=sim.kind==='car',seat=sim.camera===1,air=sim.kind==='air',f=V(Math.sin(sim.yaw),Math.cos(sim.yaw),0),target=car?model.car:model.air;
  if(sim.kind==='title'){const a=.84+Math.sin(t*.10)*.085;reuseCam.set(-8+Math.sin(a)*10.9,-525-Math.cos(a)*10.9,25.9);look.set(-10,-525,22.8);cam.fov=50;}
  else if(sim.kind==='tesla'){const a=sim.yaw+sim.head+(sim.camera===2?-2.02:0);if(seat){model.road.updateMatrixWorld();reuseCam.copy(V(0,1.48,1.09).applyMatrix4(model.road.matrixWorld));look.copy(reuseCam).add(f).z+=-.06+sim.headY;cam.fov=67;}else{const d=sim.camera===2?6.30:8.65;reuseCam.copy(sim.p).add(V(-Math.sin(a)*d,-Math.cos(a)*d,(sim.camera===2?2.25:3.55)+sim.headY*3.15));look.copy(sim.p).addScaledVector(f,.24).z+=sim.camera===2?.73:.34;cam.fov=sim.camera===2?49:58;}}
  else if(seat){let eye=car?V(...meta.driverEye):V(...meta.cockpit);const lean=car&&sim.detail?Math.sin(sim.head):0;if(lean)eye.add(V(.20*lean,.037*lean*lean,-.018*lean*lean));target.updateMatrixWorld();reuseCam.copy(eye.applyMatrix4(target.matrixWorld));let yaw=sim.yaw+(car&&sim.detail?-.32*lean:sim.head);let z=(car?(sim.detail?-.565:-.34):-.07)+sim.headY+sim.pitch*.43;look.copy(reuseCam).add(V(Math.sin(yaw),Math.cos(yaw),z));cam.fov=car?(sim.detail?55:78):68;}
  else if(car&&sim.camera===3){model.car.updateMatrixWorld();reuseCam.copy(V(0,1.80,.90).applyMatrix4(model.car.matrixWorld));look.copy(reuseCam).addScaledVector(f,1).z+=sim.headY-.014;cam.fov=68;}
  else if(car&&sim.camera===4){const a=-1.19+sim.head,right=V(f.y,-f.x,0);reuseCam.copy(sim.p).addScaledVector(right,3.25*Math.sin(a)).addScaledVector(f,3.25*Math.cos(a)).z+=1.48+sim.headY*1.4;look.copy(sim.p).addScaledVector(right,-.27).addScaledVector(f,.03).z+=1.02;cam.fov=36;}
  else{const a=sim.yaw+sim.head+(sim.camera===2?-.94:0),distance=car?8.1:13.2;reuseCam.copy(sim.p).add(V(-Math.sin(a)*distance,-Math.cos(a)*distance,car?3.15:4.65));look.copy(sim.p).addScaledVector(f,car?2.0:2.3).z+=car?.90:.62;cam.fov=car?59:60;}
  if(cam.aspect<1){const horizontal=car&&sim.detail?48:57;cam.fov=Math.max(cam.fov,Math.min(115,2*Math.atan(Math.tan(horizontal*radians/2)/cam.aspect)/radians));}
  cam.position.copy(reuseCam);cam.up.copy(up);cam.lookAt(look);cam.updateProjectionMatrix();
}
function refreshHud() {
  if (sim.kind === 'title') return;
  const driving = sim.kind === 'car';
  const freeFlight = sim.kind === 'tesla';
  const lastCheckpoint = route.length - 1;
  let section = 'Cargo flight';
  let objective = route[sim.stage][3];

  if (driving) {
    section = 'Coastal drive';
    objective = sim.free ? 'Explore the waterfront' : 'Follow the coast road';
  } else if (freeFlight) {
    section = 'Free flight';
    objective = 'Explore the bay';
  } else if (sim.landed) {
    objective = 'Delivery complete';
  } else if (sim.stage === lastCheckpoint) {
    section = 'Landing';
  } else if (isDispatchFlight()) {
    section = `Checkpoint ${sim.stage + 1} of ${lastCheckpoint}`;
  }

  if (objective !== lastObjective || by('district').textContent !== section) {
    by('district').textContent = section;
    by('objective').textContent = objective;
    lastObjective = objective;
  }
  by('speed').textContent = String(Math.round(Math.abs(sim.speed) * 3.6));
  by('alt').textContent = driving ? `${Math.round(sim.odometer)} m driven` : `Altitude ${Math.round(sim.p.z)} m`;
  const left = Math.max(0, Math.ceil(timeLimit() - journey.seconds));
  by('countdown').textContent = `${formatClock(left)} left`;
  displayRefresh();
}
function resize(){const w=innerWidth,h=innerHeight;if(w===viewWidth&&h===viewHeight)return;viewWidth=w;viewHeight=h;renderer.setPixelRatio(resScale);renderer.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();}
function render(now){requestAnimationFrame(render);if(!renderer)return;let delta=lastT?Math.min(.42,(now-lastT)/1000):1/60;lastT=now;t+=delta;const active=!document.hidden;if(!active)return;
  fpsEstimate=lerp(fpsEstimate,Math.min(100,1/Math.max(.0001,delta)),.035);if(frame%150===149&&fpsEstimate<25&&resScale>.56){resScale=Math.max(.56,resScale*.82);viewWidth=0;}resize();
  if(sim.kind==='title')sim.world+=delta;if(!sim.paused){trafficStep();const total=delta,steps=Math.max(1,Math.ceil(total*120));for(let j=0;j<steps;j++)practice(total/steps);bladePhase+=delta*(37+Math.abs(sim.speed)*.33);}
  tickModels();placeCamera();shadowAge+=delta;if(shadowAge>.105||frame===0){const f=V(Math.sin(sim.yaw)*20,Math.cos(sim.yaw)*20,0);sun.target.position.copy(sim.p).add(f);sun.position.copy(sun.target.position).add(V(-50,81,42));renderer.shadowMap.needsUpdate=true;shadowAge=0;}
  updateSea();opticsStep();reflectWater();if(now-lastHud>120){refreshHud();lastHud=now;}if(audio)actualizarPaisaje(sim,muted||sim.paused);if(engines&&audio){const base=sim.kind==='car'?39+Math.abs(sim.speed)*4.1:65+sim.target*2.4;engines[0].frequency.setTargetAtTime(base,audio.currentTime,.12);engines[1].frequency.setTargetAtTime(base*2.01,audio.currentTime,.15);}
  renderer.render(scene,cam);frame++;}
function startAudio(){try{if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();mix=audio.createGain();mix.gain.value=muted?0:.20;mix.connect(audio.destination);crearPaisaje(audio,mix);const filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=410;filter.Q.value=.52;filter.connect(mix);engines=[0,1].map((q)=>{const o=audio.createOscillator(),gain=audio.createGain();o.type=q?'sine':'triangle';o.frequency.value=50+(q*51);gain.gain.value=q?.065:.11;o.connect(gain);gain.connect(filter);o.start();return o;});}if(audio.state==='suspended')audio.resume().catch(()=>{});mix.gain.setTargetAtTime(muted?0:.20,audio.currentTime,.1);}catch{}}
function nextCamera(){if(sim.kind==='title')return;sim.camera=(sim.camera+1)%(sim.kind==='car'?5:3);sim.detail=false;sim.head=sim.headY=0;}
function toggleGuide(){if(sim.kind==='title')return;sim.guide=!sim.guide;if(sim.guide&&sim.kind==='car'){seekRoadGuide();let d=Infinity;driveRoute.forEach((p,i)=>{const dist=Math.hypot(p[0]-sim.p.x,p[1]-sim.p.y);if(dist<d){d=dist;sim.driveNode=i;}});}updateTouchControls();say(sim.guide?'Flight assist on':'Flight assist off',2);}
function title(){newJourney();sim.kind='title';sim.paused=false;sim.p.set(-8,-525,22);sim.yaw=.03;sim.pitch=sim.roll=sim.head=sim.headY=0;sim.landed=false;sim.camera=0;sim.guide=false;by('pause').hidden=by('hud').hidden=true;by('cover').hidden=false;clearInput();if(audio)mix.gain.setTargetAtTime(0,audio.currentTime,.12);}
window.addEventListener('keydown', event => {
  if (!renderer || event.defaultPrevented || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const activatesButton = (key === ' ' || key === 'enter') && event.target.closest?.('button, a[href]');
  if (activatesButton) return;
  if (key === 'escape' && sim.kind !== 'title' && !event.repeat) {
    pause();
    return;
  }
  if (sim.paused) return;
  if (sim.kind === 'title') {
    if (event.repeat || event.ctrlKey) return;
    if (key === 'enter') start('air');
    if (key === 'g') start('car');
    if (key === 't') start('tesla');
    return;
  }

  if (movementKeys.has(key)) {
    event.preventDefault();
    keys.add(key);
  }
  if (event.repeat || event.ctrlKey) return;
  if (key === 't') start('tesla');
  if (key === 'c') nextCamera();
  if (key === 'b' && sim.kind === 'car') use();
  if (key === 'g') start(sim.kind === 'car' ? 'air' : 'car');
  if (key === 'f2') {
    event.preventDefault();
    toggleGuide();
  }
  if (key === 'e' && sim.kind === 'air') use();
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => {
  clearInput();
  if (renderer && sim.kind !== 'title' && !sim.paused) pause();
});
by('world').addEventListener('pointerdown',e=>{if(sim.kind==='title'||sim.paused)return;e.target.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY,e.pointerId];});
by('world').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag[2])return;sim.head=clamp(sim.head+(e.clientX-drag[0])*.005,-1.2,1.2);sim.headY=clamp(sim.headY-(e.clientY-drag[1])*.002,-.38,.40);drag=[e.clientX,e.clientY,e.pointerId];});by('world').addEventListener('pointerup',()=>drag=null);by('world').addEventListener('pointercancel',()=>drag=null);by('world').addEventListener('contextmenu',e=>e.preventDefault());
document.querySelectorAll('[data-key]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    if (sim.paused || event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchPointers.set(event.pointerId, button);
    button.dataset.held = '';
  });
  const release = event => {
    touchPointers.delete(event.pointerId);
    for (const held of touchPointers.values()) if (held === button) return;
    delete button.dataset.held;
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
by('tesla').onclick=by('change-tesla').onclick=()=>start('tesla');by('fly').onclick=()=>start('air');by('drive').onclick=()=>start('car');by('guide').onclick=()=>start('air',true);by('view').onclick=nextCamera;by('pause-b').onclick=pause;by('touch-auto').onclick=toggleGuide;by('touch-use').onclick=use;by('resume').onclick=pause;by('return').onclick=()=>{title();by('fly').focus({preventScroll:true});};by('change').onclick=()=>start(sim.kind==='car'?'air':'car');by('auto').onclick=()=>{toggleGuide();pause();};by('mute').onclick=()=>{muted=!muted;by('mute').textContent=muted?'Unmute':'Mute';if(audio)mix.gain.setTargetAtTime(muted||sim.paused?0:.2,audio.currentTime,.1);};
async function init(){meta=JSON.parse(by('metadata').textContent);rig=meta.rig;const str=by('packed').textContent.trim();const raw=Uint8Array.fromBase64?Uint8Array.fromBase64(str):Uint8Array.from(atob(str),c=>c.charCodeAt(0));const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));buffer=await new Response(stream).arrayBuffer();by('packed').remove();drivingSample=typed(meta.guide,Float32Array);resScale=Math.min(1.25,window.devicePixelRatio||1);makeWorld();resetHands();title();by('loading').hidden=true;by('cover-actions').hidden=false;resize();requestAnimationFrame(render);}
init().catch(noticeError);
})();
