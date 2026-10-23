# Vex 3D
- `vex.glb`: modelo con rig (82 nodos, 62 mallas) y 8 clips: Idle, Listening, Thinking, Talking, Working, Greeting, Creative, Success. Abre en Blender, Three.js, Unity, Unreal.
- `vex3d.js`: `createVex(THREE)` construye el modelo por código (texturas procedurales en canvas: sustituir por `map/roughnessMap/bumpMap` propios en `shellTextures`). Expone `setPose, setEyes, setMouth, update(dt,t), buildClips, materials`.
- `vex-3d.html`: visor 360° + modo "en el editor". Carga Three.js 0.160 desde jsDelivr.
- `export.html`: página que exporta el GLB con GLTFExporter (servir la carpeta con `node_modules/three` al lado).
