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
