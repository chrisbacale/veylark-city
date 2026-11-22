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
