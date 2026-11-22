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
