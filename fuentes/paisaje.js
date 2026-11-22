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
