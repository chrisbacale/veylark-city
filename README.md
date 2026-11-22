# Veylark City

A browser-based coastal flight and driving game. Fly a medical delivery to the Miramar rooftop, drive the waterfront, or take the Roadster across the bay.

## Play

[Play Veylark City in your browser](https://veylark-city.optimisticcloth2.chatgpt.site/)

Open `index.html` in a browser with WebGL 2 and hardware acceleration. The game runs offline after you extract the full ZIP. **Start mission** opens the timed delivery. **Fly with assist** enables assistance.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Adjust throttle or brake | W / S or Up / Down | Throttle + / − |
| Steer | A / D or Left / Right | Left / Right |
| Climb or descend | Space / Ctrl | Climb / Descend |
| Apply the handbrake while driving | Space | E-brake |
| Land on the rooftop | E | Land |
| Change camera or look around | C or drag to look | Camera or swipe to look |
| Open controls and change vehicle | Esc | Pause |

## Rooftop Run

Kimi K3.1 Pro on Cerebras, through standard OpenClaw, generated this flight's five target heights and 135-second window. Fly through the checkpoints at **30, 34, 34, 38, and 32 meters**, then land at Miramar. The included briefing was adapted to English from the recorded run of November 22, 2026. The command took **7.843 seconds** from launch to response.

The game loads the saved mission and can play it offline. Generate a new mission with OpenClaw configured for `cerebras/moonshotai-kimi-k3.1-pro-trial`.

```sh
openclaw agent --session-key agent:main:veylark-demo --thinking low \
  --message-file herramientas/encargo.txt --json > respuesta-openclaw.json
node herramientas/importar-mision.mjs respuesta-openclaw.json
```

The importer verifies the model and validates the five heights and time limit. Reload the game to play the new mission.

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
