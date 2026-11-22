# Veylark City

Fly a medical delivery across a coastal city in **Rooftop Run**, a mission designed with **Kimi K3.1 Pro on Cerebras through standard OpenClaw**. Kimi writes a flight briefing, chooses how high each of five checkpoints should be relative to the route, and sets the time available to reach the rooftop. The game applies those decisions to the flight you play.

**[Play Rooftop Run in your browser](https://chrisbacale.github.io/veylark-city/)** · Select **Start mission** to fly manually or **Fly with assist** for guided flight.

## From Kimi’s response to the cockpit

In the recorded November 22 run, Kimi returned a Spanish mission title and briefing, a **135-second** time limit, and five altitude adjustments in meters: `[4, -3, 2, -4, 0]`. The published mission adapts the title and briefing to English and uses the five adjustments and time limit from that response.

| Checkpoint | Base height | Kimi’s adjustment | In-game target |
| --- | ---: | ---: | ---: |
| Canal entrance | 26 m | +4 m | 30 m |
| Bay bridge | 37 m | −3 m | 34 m |
| Marina del Sol | 32 m | +2 m | 34 m |
| Palm promenade | 42 m | −4 m | 38 m |
| Miramar approach | 32 m | 0 m | 32 m |

At takeoff, the timer starts at **02:15** and the first objective reads **Canal entrance · 30 m**. The city, checkpoint positions and rooftop belong to the simulator. The browser loads the saved mission, so anyone can fly it without an API key, including offline from a downloaded copy.

**Recorded generation time:** OpenClaw reported **5.274 seconds** for the agent run. The complete command took **7.843 seconds** from launch to response. Both figures come from one run and describe mission generation. [Saved mission](juego/mision.js) · [How the simulator applies the response](fuentes/jugar.js)

## Generate another mission

With standard OpenClaw configured to use `cerebras/moonshotai-kimi-k3.1-pro-trial`, run these commands from the repository root. The included English prompt requests a new mission on the same route.

```sh
openclaw agent --session-key agent:main:veylark-demo --thinking off \
  --message-file herramientas/encargo.txt --json > respuesta-openclaw.json
node herramientas/importar-mision.mjs respuesta-openclaw.json
```

The importer checks the reported provider and model, validates the title, briefing, timer and five offsets, and writes the accepted mission to `juego/mision.js`. Open or reload your local `index.html` to fly it. [Mission prompt](herramientas/encargo.txt) · [Importer](herramientas/importar-mision.mjs)

## Controls

Use a browser with WebGL 2 and hardware acceleration. The menu also offers a coastal drive and free flight.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Adjust throttle or brake | W / S or Up / Down | Throttle + / − |
| Steer | A / D or Left / Right | Left / Right |
| Climb or descend | Space / Ctrl | Climb / Descend |
| Apply the handbrake while driving | Space | E-brake |
| Land on the rooftop | E | Land |
| Change camera or look around | C or drag to look | Camera or swipe to look |
| Open controls and change vehicle | Esc | Pause |

## Project files

| Directory | Contents |
| --- | --- |
| `fuentes/` | Simulation, route, optics, surfaces, and audio source |
| `juego/` | Browser runtime and saved mission |
| `recursos/` | Geometry, materials, lighting, water, map, and route data |
| `motor/` | Local Three.js, fflate, and the resource loader |
| `licencias/` | Third-party license notices |
| `fonts/` | Locally bundled display and UI fonts |
| `herramientas/` | Build and mission import scripts |

Keep the directories next to `index.html`. Run `node herramientas/compilar.mjs` after editing `fuentes/`. If you need the unpacked asset atlas, run `node herramientas/extraer-recursos.mjs destination`. The scripts use Node.js without extra packages.

Third-party library and typeface notices are included in `licencias/`.
