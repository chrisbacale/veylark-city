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
const mirrors=[], previousSite=V(1e6,1e6,1e6);
let lastMirror=-2,lastProbe=-9,reflectionCamera,reflectionFilter,reflectionTarget,mapScreen,waterTarget,waterCamera,lastWater=-1;
function prepareOptics(){
  for(const [x,y,z,wide,fov] of [[0,-2.43,1.3,352,24],[-1.09,.5,.91,176,35],[1.09,.5,.91,176,35]]){
    const target=new T.WebGLRenderTarget(wide,Math.round(wide*(x===0?.278:.56)),{type:T.HalfFloatType});
    const camera=new T.PerspectiveCamera(fov,target.width/target.height,.16,2400);camera.up.copy(up);
    mirrors.push({target,camera,origin:V(x,y,z)});
  }
  function glass(left,right){
    return new T.ShaderMaterial({side:T.DoubleSide,uniforms:{left:{value:left.texture},right:{value:right.texture}},
      vertexShader:'varying vec2 st;varying float sideX;void main(){st=uv;sideX=position.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 st;varying float sideX;uniform sampler2D left;uniform sampler2D right;void main(){vec2 q=vec2(1.-st.x,1.-st.y);vec3 c=sideX<0.?texture2D(left,q).rgb:texture2D(right,q).rgb;gl_FragColor=vec4(c*vec3(.86,.93,.96),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
  }
  if(assets.rearView)assets.rearView.mesh.material[0]=glass(mirrors[0].target,mirrors[0].target);
  const materialIndex=id=>meta.meshes.carBody.groups.findIndex(g=>g[2]===id);
  const sides=materialIndex(36),nav=materialIndex(37);
  if(sides>=0)assets.carBody.mesh.material[sides]=glass(mirrors[1].target,mirrors[2].target);
  if(nav>=0){
    mapScreen=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{chart:{value:sourceMap},place:{value:new T.Vector2()},heading:{value:0}},
      vertexShader:'varying vec2 st;void main(){st=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 st;uniform sampler2D chart;uniform vec2 place;uniform float heading;void main(){vec2 f=vec2(sin(heading),cos(heading)),r=vec2(f.y,-f.x);vec2 pt=place+r*((st.x-.5)*238.)+f*((.67-st.y)*157.);vec2 chartUV=vec2(1024.+pt.x,1408.-pt.y)/2048.;vec3 c=texture2D(chart,chartUV).rgb;vec2 d=st-vec2(.5,.67);float arrow=step(-.067,d.y)*step(d.y,.044)*step(abs(d.x),(.068+d.y)*.40);c=mix(c,vec3(.84,.55,.19),arrow);gl_FragColor=vec4(c*1.25,1.);\n#include <colorspace_fragment>\n}'});
    assets.carBody.mesh.material[nav]=mapScreen;
  }
  const size=matchMedia('(pointer:coarse)').matches?96:128;
  const cube=new T.WebGLCubeRenderTarget(size,{type:T.HalfFloatType,generateMipmaps:false});
  reflectionCamera=new T.CubeCamera(.8,2850,cube);scene.add(reflectionCamera);
  reflectionFilter=new T.PMREMGenerator(renderer);
  waterTarget=new T.WebGLRenderTarget(720,405,{type:T.HalfFloatType,generateMipmaps:false});
  waterCamera=new T.PerspectiveCamera();
}
function opticsStep(){
  const car=sim.kind==='car',player=car?model.car:model.road;
  if(mapScreen){mapScreen.uniforms.place.value.set(sim.p.x,sim.p.y);mapScreen.uniforms.heading.value=sim.yaw;}
  if(car&&sim.camera===1&&t-lastMirror>.14){
    const forward=V(Math.sin(sim.yaw),Math.cos(sim.yaw),0),right=V(forward.y,-forward.x,0);
    model.car.updateMatrixWorld();model.car.visible=false;
    for(const m of mirrors){
      m.camera.position.copy(m.origin).applyMatrix4(model.car.matrixWorld);
      const aim=m.camera.position.clone().sub(forward).addScaledVector(right,Math.sign(m.origin.x)*.29);aim.z-=.057;m.camera.lookAt(aim);
      renderer.setRenderTarget(m.target);renderer.render(scene,m.camera);
    }
    model.car.visible=true;renderer.setRenderTarget(null);lastMirror=t;
  }
  if((car||sim.kind==='tesla')&&player&&(previousSite.distanceToSquared(sim.p)>36*36||t-lastProbe>12)){
    const visibility=player.visible;player.visible=false;
    reflectionCamera.position.copy(sim.p);reflectionCamera.position.z+=1.06;
    reflectionCamera.update(renderer,scene);player.visible=visibility;
    reflectionTarget=reflectionFilter.fromCubemap(reflectionCamera.renderTarget.texture,reflectionTarget);
    for(const name of ['carBody','roadsterAirframe']){
      const part=assets[name];if(!part)continue;
      part.materials.forEach((m,i)=>{if([15,16,19].includes(meta.meshes[name].groups[i][2])&&m.envMap!==reflectionTarget.texture){m.envMap=reflectionTarget.texture;m.needsUpdate=true;}});
    }
    previousSite.copy(sim.p);lastProbe=t;
  }
}
function reflectWater(){
  if(sim.kind==='car'){water.material.uniforms.reflectMix.value=0;return;}
  if(t-lastWater<.037)return;
  const forward=V();cam.getWorldDirection(forward);waterCamera.position.copy(cam.position);
  waterCamera.position.z=-.14-cam.position.z;forward.z=-forward.z;
  const reflectedUp=V(0,1,0).applyQuaternion(cam.quaternion);reflectedUp.z=-reflectedUp.z;waterCamera.up.copy(reflectedUp);
  waterCamera.lookAt(waterCamera.position.clone().add(forward));waterCamera.aspect=cam.aspect;
  waterCamera.near=cam.near;waterCamera.far=cam.far;waterCamera.fov=cam.fov;waterCamera.updateProjectionMatrix();waterCamera.updateMatrixWorld();
  const u=water.material.uniforms;u.reflectVP.value.multiplyMatrices(waterCamera.projectionMatrix,waterCamera.matrixWorldInverse);
  const visible=beacon.visible;beacon.visible=false;water.visible=false;
  renderer.setRenderTarget(waterTarget);renderer.render(scene,waterCamera);renderer.setRenderTarget(null);water.visible=true;beacon.visible=visible;
  u.reflected.value=waterTarget.texture;u.reflectMix.value=1;lastWater=t;
}
function coastalWater(){
  const wake=Array.from({length:8},()=>new T.Vector4(-22,-278,80,0));
  const trailAxis=Array.from({length:8},()=>new T.Vector3(1,0,0));
  const bottom=new T.DataTexture(typed(meta.seabed,Uint8Array),512,512,T.RGBAFormat);
  bottom.minFilter=T.LinearMipmapLinearFilter;bottom.magFilter=T.LinearFilter;bottom.generateMipmaps=true;bottom.needsUpdate=true;
  const ocean=new T.Data3DTexture(typed(meta.ocean,Uint8Array),96,96,40);
  ocean.format=T.RGBAFormat;ocean.type=T.UnsignedByteType;ocean.minFilter=ocean.magFilter=T.LinearFilter;
  ocean.wrapS=ocean.wrapT=ocean.wrapR=T.RepeatWrapping;ocean.unpackAlignment=1;ocean.needsUpdate=true;
  const u={clock:{value:0},env:{value:skyTexture},spectrum:{value:ocean},seabed:{value:bottom},fourFans:{value:1},liftSite:{value:V()},thrust:{value:0},heading:{value:0},wake:{value:wake},trailAxis:{value:trailAxis},boatWake:{value:Array.from({length:5},()=>new T.Vector4())},reflected:{value:waterTarget.texture},reflectVP:{value:M()},reflectMix:{value:0}};
  const field=`
    uniform vec3 liftSite;uniform float thrust,heading,clock,fourFans;uniform vec4 wake[8];uniform vec3 trailAxis[8];uniform highp sampler3D spectrum;
    vec2 pressure(vec2 p){
      if(thrust<=.01||liftSite.z>16.||distance(p,liftSite.xy)>58.)return vec2(0.);
      float a0=max(0.,clock-wake[0].w),lag=clamp(.12+.035*liftSite.z,.14,.31);
      vec2 impact=a0>lag?mix(wake[0].xy,liftSite.xy,1.-lag/max(.001,a0)):mix(wake[0].xy,wake[1].xy,clamp((lag-a0)/.23,0.,1.));
      vec2 f=vec2(sin(heading),cos(heading));vec2 d=p-impact;
      vec2 l=vec2(dot(d,vec2(f.y,-f.x)),dot(d,f)),o=vec2(0.);float radius=mix(1.79,.61,fourFans)+.18*liftSite.z;
      for(int i=0;i<4;i++){if(fourFans<.5&&i>1)continue;
        vec2 h=fourFans>.5?vec2((i==0||i==2)?-.735:.735,i<2?1.34:-1.37):vec2(i==0?-2.12:2.12,0.);float r=length(l-h)/radius;
        float lip=exp(-6.2*(r-1.23)*(r-1.23));o+=vec2(mix(.112,.190,fourFans)*(-exp(-r*r*1.86)+.40*lip),.47*lip)*exp(-.21*max(0.,liftSite.z-.8));}
      o*=thrust;
      for(int i=0;i<8;i++){vec4 s=wake[i];float a=max(0.,clock-s.w);vec2 d=p-s.xy-vec2(.34,-.14)*a;
        float crossDistance=dot(d,trailAxis[i].xy);d-=trailAxis[i].xy*crossDistance*inversesqrt(crossDistance*crossDistance+.51)*mix(1.33,.62,fourFans)*exp(-a*.39);
        float r=length(d);float b=(r-(1.4+s.z*.18+a*2.24))/(.53+.35*a);float ring=trailAxis[i].z*exp(-b*b-max(0.,s.z-.8)*.22-a*1.23)*smoothstep(0.,.28,a);
        o+=vec2(.018*sin(r*4.4-clock*.41),.16)*ring;}
      return o;
    }
  `;
  const vert=`varying vec3 wp;${field}void main(){wp=(modelMatrix*vec4(position,1.)).xyz;
    wp.z+=(texture(spectrum,vec3(wp.xy/71.,clock/16.)).b-.5)*1.98+.054*sin(dot(wp.xy,vec2(.081,.117))*.61-clock*1.02)+pressure(wp.xy).x;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`;
  const frag=`varying vec3 wp;uniform sampler2D env,reflected,seabed;uniform vec4 boatWake[5];uniform mat4 reflectVP;uniform float reflectMix;${field}
    vec2 gradient(vec2 p,float distanceEye){
      float f=1./(1.+distanceEye*.013);
      vec2 rotated=vec2(.787*p.x+.617*p.y,-.617*p.x+.787*p.y);
      vec2 s=texture(spectrum,vec3(rotated/16.8+vec2(.334,.61),clock/7.93+.36)).rg-.5;
      return (texture(spectrum,vec3(p/71.,clock/16.)).rg-.5)*1.26
        +vec2(.787*s.x-.617*s.y,.617*s.x+.787*s.y)*(.38+.44*f)
        +(texture(spectrum,vec3(p.yx/4.7+vec2(.29,.48),clock/4.87+.74)).gr-.5)*(.18+.28*f);
    }
    void main(){vec2 p=wp.xy;float d=distance(cameraPosition,wp);vec2 force=pressure(p),s=gradient(p,d);
      if(force.y>.001||abs(force.x)>.0001)s+=(vec2(pressure(p+vec2(.085,0.)).x,pressure(p+vec2(0.,.085)).x)-force.xx)/.085;
      vec3 n=normalize(vec3(-s,1.)),v=normalize(cameraPosition-wp),r=reflect(-v,n);const float pi=3.14159265;
      vec2 uv=vec2(atan(r.z,r.x)/(2.*pi)+.5,asin(clamp(r.y,-1.,1.))/pi+.5);float f=.025+.91*pow(1.-abs(dot(n,v)),4.7);
      vec4 projected=reflectVP*vec4(wp,1.);vec2 local=projected.xy/max(.001,projected.w)*.5+.5+s*vec2(.043,.080)*clamp(112./max(20.,d),0.,1.);
      float edge=clamp(min(min(local.x,local.y),min(1.-local.x,1.-local.y))*20.,0.,1.);
      vec3 light=mix(texture2D(env,uv).rgb,texture2D(reflected,clamp(local,.002,.998)).rgb,reflectMix*edge*step(0.,projected.w)*.93);
      vec2 extent=vec2(2304.,2688.),origin=vec2(1152.,768.);vec4 bottom=texture2D(seabed,(p+origin)/extent);
      float depth=max(.55,bottom.r*24.);vec3 rayIn=refract(-v,n,1./1.333);vec2 sampleBottom=p+rayIn.xy*depth/max(.22,-rayIn.z);
      vec4 substrate=texture2D(seabed,(sampleBottom+origin)/extent);vec3 beam=exp(-vec3(.228,.088,.063)*depth*(1./max(.24,-rayIn.z)+1.36));
      float bedNoise=texture(spectrum,vec3(sampleBottom/3.2,0.)).b,grass=smoothstep(.34,.76,substrate.g+.16*(bedNoise-.5));
      vec3 sediment=mix(vec3(.39,.37,.238),vec3(.080,.150,.102),grass)*(.84+.26*substrate.a);
      const vec3 sunDir=vec3(-.442,.893,.084);vec3 body=vec3(.010,.052,.075)*(.82+.34*bottom.a)*(1.-beam)+sediment*beam*(.51+.25*max(0.,dot(n,sunDir)));
      vec3 h=normalize(v+sunDir);vec3 c=mix(body,light,clamp(f+.034,0.,1.));
      float nh=max(0.,dot(n,h)),pixelSpan=max(length(dFdx(p)),length(dFdy(p))),variance=.008+.010*clamp(pixelSpan*1.7,0.,1.);
      float glint=exp((nh*nh-1.)/max(.0009,variance*nh*nh));c+=vec3(2.45,1.62,.86)*(glint+.041*pow(nh,39.));
      float nearNoise=texture(spectrum,vec3(p.xy/2.34+vec2(clock*.028,-clock*.041),clock/6.7)).b;
      float broadNoise=texture(spectrum,vec3(p.yx/6.92+vec2(-clock*.018,clock*.022),clock/8.9)).g;
      float broken=.06+.84*smoothstep(.37,.63,nearNoise*.68+broadNoise*.32);
      float trails=0.;for(int k=0;k<5;k++){vec4 boat=boatWake[k];vec2 f=vec2(sin(boat.z),cos(boat.z));vec2 d=p-boat.xy;
        float aft=-dot(d,f),side=abs(dot(d,vec2(f.y,-f.x)));float radius=1.45+aft*.205;
        float arm=(side-radius)/max(.7,.08*aft);trails+=step(0.,aft)*boat.w*(.74*exp(-arm*arm-max(0.,aft)/32.)+.40*exp(-side*side/max(1.,aft*.55)-max(0.,aft)/17.));}
      float shore=bottom.b*smoothstep(.37,.73,texture(spectrum,vec3(p/71.,clock/16.)).a+.22*nearNoise)*(.23+.47*broken);
      c=mix(c,vec3(.54,.64,.65),clamp((force.y*(.18+.68*broken)+trails*(.38+.54*broken))*.74+shore*.38,0.,.80));gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const grid=new T.PlaneGeometry(2,2,196,196),points=grid.attributes.position;
  function spread(x){const q=Math.abs(x);return Math.sign(x)*(22*q+56*q**3+3050*q**7);}
  for(let i=0;i<points.count;i++)points.setXY(i,spread(points.getX(i)),spread(points.getY(i)));
  grid.computeBoundingSphere();
  const sea=new T.Mesh(grid,new T.ShaderMaterial({uniforms:u,vertexShader:vert,fragmentShader:frag}));
  sea.add(rotorSpray(u));return sea;
}

function rotorSpray(uniforms){
  const count=420,geometry=new T.InstancedBufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0],3));
  geometry.setAttribute('particle',new T.InstancedBufferAttribute(Float32Array.from({length:count},(_,j)=>j),1));
  geometry.instanceCount=count;
  const vertexShader=`attribute float particle;varying vec2 square;varying float opacity;
    uniform float clock,fourFans,thrust;uniform vec4 wake[8];uniform vec3 trailAxis[8];uniform highp sampler3D spectrum;
    float randomNumber(uint p,uint life,uint channel){uint n=p*747796405u+life*2891336453u+channel*277803737u+12345u;n=((n>>((n>>28u)+4u))^n)*277803737u;return float((n^(n>>22u))>>8u)/16777216.;}
    void main(){uint id=uint(particle);float life=.37+.31*randomNumber(id,0u,1u),cycles=clock/life+randomNumber(id,0u,2u),phase=fract(cycles),age=phase*life;
      uint generation=uint(floor(cycles));float angle=6.283185*randomNumber(id,generation,3u),spread=.72+.55*randomNumber(id,generation,4u);
      vec2 radial=vec2(cos(angle),sin(angle));float index=clamp((age+.18-(clock-wake[0].w))/.23,0.,6.99);int j=int(index);
      vec3 source=mix(wake[j].xyz,wake[j+1].xyz,fract(index)),axis=mix(trailAxis[j],trailAxis[j+1],fract(index));vec2 right=normalize(axis.xy),forward=vec2(-right.y,right.x);
      vec2 jet=fourFans>.5?vec2(((id%2u)==0u)?-.735:.735,((id/2u)%2u)==0u?-1.37:1.34):vec2((id%2u)==0u?-2.12:2.12,0.);
      vec2 velocity=radial*(2.35+1.95*spread)*axis.z+vec2(.38,-.16);vec2 xy=source.xy+jet.x*right+jet.y*forward+radial*((mix(1.72,.61,fourFans)+.18*source.z)*spread)+age*velocity;
      float wave=(textureLod(spectrum,vec3(xy/71.,clock/16.),0.).b-.5)*1.98+.054*sin(dot(xy,vec2(.081,.117))*.61-clock*1.02);
      float lift=(1.42+1.27*spread)*axis.z;vec4 eye=viewMatrix*vec4(xy,wave+.055+age*lift-4.905*age*age,1.);
      vec2 movement=(mat3(viewMatrix)*vec3(velocity,lift-age*9.81)).xy;vec2 tangent=movement/max(.01,length(movement));float seed=randomNumber(id,generation,5u);
      float radius=(.010+.032*seed*seed+.018*age)*mix(1.3,1.,fourFans);eye.xy+=tangent*position.x*(radius+min(.03,length(movement)*.006))+vec2(-tangent.y,tangent.x)*position.y*radius*.64;
      square=position.xy;opacity=smoothstep(0.,.10,phase)*(1.-smoothstep(.43,1.,phase))*exp(-max(0.,source.z-1.1)*.46)*axis.z*min(1.,thrust*4.)*(.11+.055*seed);gl_Position=projectionMatrix*eye;}`;
  const fragmentShader=`varying vec2 square;varying float opacity;void main(){float r=dot(square,square);if(r>1.||opacity<.001)discard;gl_FragColor=vec4(.79,.83,.79,opacity*pow(1.-r,1.7));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
  const particles=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,side:T.DoubleSide}));
  particles.frustumCulled=false;return particles;
}
let lastWake=-1;
function resetWake(){
  const u=water.material.uniforms,history=u.wake.value;
  history.forEach((p,k)=>{const age=k*.23;p.set(sim.p.x-Math.sin(sim.yaw)*sim.speed*age,sim.p.y-Math.cos(sim.yaw)*sim.speed*age,sim.p.z,sim.world-age);u.trailAxis.value[k].set(Math.cos(sim.yaw),-Math.sin(sim.yaw),sim.thrust??1);});
  lastWake=sim.world;
}
function updateSea(){
  const u=water.material.uniforms;u.clock.value=sim.world;u.heading.value=sim.yaw;u.liftSite.value.copy(sim.p);u.fourFans.value=sim.kind==='tesla'?1:0;
  if(sim.kind==='tesla'){
    const h=clamp(sim.p.z+.417,0,18),back=-Math.tan(sim.pitch)*h,side=Math.tan(sim.roll)*h;
    u.liftSite.value.x+=Math.sin(sim.yaw)*back+Math.cos(sim.yaw)*side;
    u.liftSite.value.y+=Math.cos(sim.yaw)*back-Math.sin(sim.yaw)*side;
  }
  water.position.x=Math.round(sim.p.x*4)*.25;water.position.y=Math.round(sim.p.y*4)*.25;
  u.thrust.value=sim.kind==='tesla'?sim.thrust:sim.kind==='air'&&!sim.landed?.8:0;
  boats.forEach((boat,k)=>u.boatWake.value[k].set(boat.position.x,boat.position.y,-boat.rotation.z,1));
  if(sim.world-lastWake>=.23||sim.world<lastWake){const history=u.wake.value,axis=u.trailAxis.value;for(let i=history.length-1;i>0;i--){history[i].copy(history[i-1]);axis[i].copy(axis[i-1]);}const p=u.liftSite.value;history[0].set(p.x,p.y,p.z,sim.world);axis[0].set(Math.cos(sim.yaw),-Math.sin(sim.yaw),u.thrust.value);lastWake=sim.world;}
}

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

let urbanAlbedo,urbanNormal;
function loadCityTextures(){
  function surface(bytes){
    const map=new T.DataArrayTexture(typed(bytes,Uint8Array),256,256,9);
    map.format=T.RGBAFormat;map.type=T.UnsignedByteType;map.wrapS=map.wrapT=T.RepeatWrapping;
    map.generateMipmaps=true;map.minFilter=T.LinearMipmapLinearFilter;map.magFilter=T.LinearFilter;
    map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());map.needsUpdate=true;return map;
  }
  urbanAlbedo=surface(meta.albedo);urbanNormal=surface(meta.normal);
}
function cityFinish(sh,id){
  sh.uniforms.vcSky={value:skyTexture};sh.uniforms.vcMaterial={value:urbanAlbedo};sh.uniforms.vcBump={value:urbanNormal};
  sh.vertexShader='varying vec2 panelUV;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npanelUV=uv;');
  const g=`
    varying vec2 panelUV;uniform sampler2D vcSky;uniform highp sampler2DArray vcMaterial,vcBump;
    float officeSeed(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.545);}
    float insideShape(vec2 q,vec2 radius){vec2 e=radius-abs(q);return smoothstep(-.009,.009,min(e.x,e.y));}
    vec3 windowSky(vec3 r){vec2 uvSky=vec2(atan(r.z,r.x)*.15915494+.5,asin(clamp(r.y,-1.,1.))*.31830989+.5);return texture2D(vcSky,uvSky).rgb;}
    vec3 furnished(vec2 st,vec2 viewRay,float seed){
      vec2 reach=mix(vec2(0.),vec2(1.),step(vec2(0.),viewRay));
      vec2 arrival=(reach-st)/(sign(viewRay+1.e-6)*max(abs(viewRay),vec2(.0001)));
      float travel=clamp(min(arrival.x,arrival.y),0.,1.);vec2 at=st+viewRay*travel;
      bool sideFace=arrival.x<1.&&arrival.x<arrival.y;bool topFace=arrival.y<1.&&arrival.y<=arrival.x;
      vec2 face=sideFace?vec2(travel,at.y):topFace?vec2(at.x,travel):at;
      vec3 wall=mix(vec3(.10,.071,.054),vec3(.33,.225,.143),seed)*(.68+.32*face.y);
      if(topFace){if(viewRay.y<0.)return vec3(.106,.075,.053)*(.64+.3*smoothstep(.01,.14,fract(face.x*7.+floor(face.y*2.)*.31)));
        return wall+vec3(.95,.69,.41)*insideShape(face-vec2(.5,.47),vec2(.12,.024))*seed;}
      float art=insideShape(face-vec2(.57,.64),vec2(.175,.142));
      float shade=insideShape(face-vec2(.17,.44),vec2(.058,.050));
      float sofa=insideShape(face-vec2(.52,.16),vec2(.30,.09));
      wall=mix(wall,vec3(.085,.161,.143),art*.86+sofa*.78);
      return wall+vec3(1.16,.71,.27)*shade*seed;
    }
  `;
  sh.fragmentShader=g+sh.fragmentShader;
  const facade=id===1||id===2,layer={0:0,1:0,2:0,3:1,4:2,5:5,6:6,9:7,10:3,11:8}[id];
  const tile=[.8,1.5,1.,.6,.6,.28,.75,1.2,.45][layer];
  let finish=`
    vec3 wn=normalize(vcRestN),ep=normalize(cameraPosition-vcLocal);bool wallFace=abs(wn.z)<.68;
    vec2 wallUv=vec2(abs(wn.x)>abs(wn.y)?vcLocal.y:vcLocal.x,vcLocal.z);
    vec2 geoUV=(wallFace?wallUv:vcLocal.xy)/${tile.toFixed(3)};
    vec4 grains=texture(vcMaterial,vec3(geoUV,${layer}.0));vec4 fineBump=texture(vcBump,vec3(geoUV,${layer}.0));
    diffuseColor.rgb*=mix(vec3(1.),grains.rgb/vec3(.811),.80)*(.59+.41*fineBump.a);
    roughnessFactor=clamp(mix(roughnessFactor,grains.a,.56),.12,.96);
    float cityPane=0.;vec3 insideLight=vec3(0.);
  `;
  if(facade)finish+=`
    if(wallFace){
      float plane=floor(dot(vcLocal.xy,wn.xy)*.43+.379),family=officeSeed(vec2(plane,15.7));
      vec2 roomUnits=wallUv/vec2(${id===1?'1.75+family*.68':'2.12+family*1.12'},3.25);
      vec2 cell=floor(roomUnits),s=fract(roomUnits),aa=max(fwidth(roomUnits),vec2(.001));
      vec2 margin=${id===1?'vec2(.028,.045)':'vec2(.075+.045*family,.128+.049*family)'};
      vec2 aperture=smoothstep(margin-aa,margin+aa,min(s,1.-s));cityPane=aperture.x*aperture.y;
      float tenant=officeSeed(cell+vec2(plane*.31,91.2)),lit=smoothstep(.72,.92,tenant);
      vec3 sky=windowSky(reflect(-ep,wn));vec2 proj=vec2(abs(wn.x)>abs(wn.y)?ep.y:ep.x,ep.z)/max(.27,abs(dot(ep,wn)));
      vec3 interior=furnished(s,-proj*.52,tenant);
      if(panelUV.x>1.5&&length(cameraPosition-vcLocal)<190.){
        s=clamp(panelUV-vec2(2.,0.),.002,.998);interior=furnished(s,-proj*.88,tenant);cityPane=.96;
      }
      float blinds=step(.88,tenant)*smoothstep(.28,.71,fract(s.y*12.));
      vec3 glazing=mix(vec3(.027,.061,.087),sky*.42,.63+.1*family);
      diffuseColor.rgb=mix(diffuseColor.rgb,mix(glazing,interior,.18+.49*lit)*(1.-.14*blinds),cityPane);
      roughnessFactor=mix(roughnessFactor,.17+.04*family,cityPane);metalnessFactor=mix(metalnessFactor,.26,cityPane);
      insideLight=cityPane*interior*(.058+.59*lit)*(1.-.23*blinds);
    }
  `;
  sh.fragmentShader=sh.fragmentShader.replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\n'+finish);
  sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=insideLight;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
     vec2 smallNormal=(fineBump.rg-.5)*.38*(1.-cityPane);
     vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition);
     vec2 st0=dFdx(geoUV),st1=dFdy(geoUV);
     vec3 tang=q0*st1.y-q1*st0.y,bitan=q1*st0.x-q0*st1.x;
     float normalSize=max(length(tang),length(bitan));
     if(normalSize>.0000001)normal=normalize(normal+(tang*smallNormal.x+bitan*smallNormal.y)/normalSize);
  `);
}

// Capas procedurales de costa. El motor tonal ya se mezcla en jugar.js.
let paisajeActivo;

function crearPaisaje(audio, mix) {
  if (paisajeActivo?.audio === audio && paisajeActivo.mix === mix) return;
  if (paisajeActivo) {
    if (paisajeActivo.audio.state !== 'closed') paisajeActivo.ruido.stop();
    paisajeActivo.bus.disconnect();
  }

  const sampleRate = audio.sampleRate;
  const muestras = Math.round(sampleRate * 5.3);
  const empalme = Math.round(sampleRate * .028);
  const buffer = audio.createBuffer(2, muestras + empalme, sampleRate);
  const izq = buffer.getChannelData(0), der = buffer.getChannelData(1);
  let semilla = 72137;
  const muestra = () => {
    semilla = (Math.imul(1664525, semilla) + 1013904223) >>> 0;
    return (semilla / 2147483648) - 1;
  };
  for (let i = 0; i < izq.length; i++) {
    const comun = .33 * muestra();
    izq[i] = comun + .67 * muestra();
    der[i] = comun + .67 * muestra();
  }
  // Superponer dos extremos del mismo búfer evita un golpe en cada vuelta.
  for (const canal of [izq, der]) {
    for (let i = 0; i < empalme; i++) {
      const fase = (i / (empalme - 1)) * Math.PI * .5;
      canal[muestras + i] = Math.cos(fase) * canal[muestras + i] + Math.sin(fase) * canal[i];
    }
  }

  const ruido = audio.createBufferSource();
  const bus = audio.createGain();
  bus.gain.value = 0;
  bus.connect(mix);
  ruido.buffer = buffer;
  ruido.loop = true;
  ruido.loopStart = empalme / sampleRate;
  ruido.loopEnd = buffer.duration;

  function capa(tipo, frecuencia, resonancia, pan) {
    const filtro = audio.createBiquadFilter();
    const nivel = audio.createGain();
    const espacio = audio.createStereoPanner();
    filtro.type = tipo;
    filtro.frequency.value = frecuencia;
    filtro.Q.value = resonancia;
    nivel.gain.value = 0;
    espacio.pan.value = pan;
    ruido.connect(filtro);
    filtro.connect(nivel);
    nivel.connect(espacio);
    espacio.connect(bus);
    return {filtro, nivel, espacio};
  }

  paisajeActivo = {audio, mix, ruido, bus, ultima: -Infinity, silencio: true,
    mar: capa('lowpass', 870, .64, -.12), viento: capa('bandpass', 900, .52, 0),
    espuma: capa('bandpass', 3400, .64, .12), calle: capa('bandpass', 460, .57, .18)};
  ruido.start(0, ruido.loopStart);
}

function actualizarPaisaje(sim, mutedOrPaused) {
  const p = paisajeActivo;
  if (!p || p.audio.state !== 'running') return;
  const instante = p.audio.currentTime;
  const silencio = Boolean(mutedOrPaused || sim.paused || sim.kind === 'title');
  const fundir = (param, valor, tiempo) => param.setTargetAtTime(valor, instante, tiempo);
  if (silencio !== p.silencio) {
    fundir(p.bus.gain, silencio ? 0 : 1, silencio ? .045 : .09);
    p.silencio = silencio;
    p.ultima = -Infinity;
  }
  if (silencio || instante - p.ultima < .045) return;
  p.ultima = instante;

  const unidad = valor => Math.max(0, Math.min(1, valor));
  const suave = valor => {const a = unidad(valor); return a * a * (3 - 2 * a);};
  const altura = Math.max(0, sim.p.z);
  const velocidad = Math.abs(sim.speed);
  const cabina = sim.camera === 1;
  const tierra = sim.kind === 'car';
  const tesla = sim.kind === 'tesla';
  const tiempo = sim.world;
  const ejeCosta = sim.p.x >= 0 ? 166 : -160;
  const distanciaCosta = Math.abs(ejeCosta - sim.p.x);
  const nivelMar = 1 / (1 + altura * .038 + (tierra ? distanciaCosta * .022 : 0));
  const oleada = .77 + .14 * Math.sin(tiempo * 1.58 + sim.p.y * .024) + .09 * Math.sin(tiempo * 3.32);
  const paneoCosta = Math.sign(ejeCosta - sim.p.x) * Math.cos(sim.yaw + (sim.head || 0));
  const rasante = suave((8.4 - altura) / 6.9);
  const carga = .76 + .35 * unidad(((sim.thrust ?? 1) - .54) / .91);

  const modula = (capa, volumen, frecuencia, pan, tiempo = .16) => {
    fundir(capa.nivel.gain, volumen, tiempo);
    fundir(capa.filtro.frequency, frecuencia, .19);
    fundir(capa.espacio.pan, pan, .12);
  };

  modula(p.mar, nivelMar * oleada * (cabina ? .069 : .12), cabina ? 490 : 1040, -.29 * paneoCosta);
  const aire = sim.landed ? .015 : .024 + .13 * suave(velocidad / (tierra ? 25 : 36));
  modula(p.viento, aire * (cabina ? .44 : 1), (cabina ? 480 : 920) + 32 * velocidad, unidad((sim.turn + 1) * .5) * .42 - .21);
  const spray = (!tierra && !sim.landed ? (tesla ? .22 : .048) : 0) * rasante * carga * (cabina ? .34 : 1);
  const turbulencia = .77 + .16 * Math.sin(tiempo * 6.73 + sim.p.x * .06) + .07 * Math.sin(tiempo * 13.1);
  modula(p.espuma, spray * turbulencia, (cabina ? 1800 : 3300) + 27 * velocidad, Math.sin(tiempo * 2.3) * .18, spray > .018 ? .13 : .34);
  const proximidadTrafico = tierra ? .66 + .24 * suave(velocidad / 14) : (1 - suave(distanciaCosta / 135)) / (1 + altura * .072);
  const rodada = .81 + .19 * Math.sin(tiempo * 1.91 + sim.p.y * .019);
  modula(p.calle, .132 * proximidadTrafico * rodada * (cabina ? .49 : 1), (cabina ? 300 : 540) + 15 * velocidad, .46 * paneoCosta);
}

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
function init(){
  const { metadata, buffer: atlas } = ViceCityLoadResources(ViceCityMetadata, ViceCityBundle);
  meta = metadata;
  rig = meta.rig;
  buffer = atlas;
  delete globalThis.ViceCityBundle;
  delete globalThis.ViceCityMetadata;
  drivingSample = typed(meta.guide, Float32Array);
  resScale = Math.min(usingTouch() ? 1 : 1.25, window.devicePixelRatio || 1);
  makeWorld();
  resetHands();
  title();
  by('loading').hidden = true;
  by('cover-actions').hidden = false;
  resize();
  requestAnimationFrame(render);
}
Promise.resolve().then(init).catch(noticeError);
})();
