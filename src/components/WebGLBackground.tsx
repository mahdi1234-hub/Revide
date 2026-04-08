"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function WebGLBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(0, 1.2, 7.6);
    camera.lookAt(0, -0.4, 0);

    function resize() {
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.floor(r.width));
      const h = Math.max(2, Math.floor(r.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Lights
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(-2, 2, 4);
    scene.add(rimLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Planet
    const planetGeom = new THREE.SphereGeometry(3.9, 96, 96);
    const planetMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color(0x2a2c33) },
        uRim: { value: new THREE.Color(0x6b5cff) },
        uRim2: { value: new THREE.Color(0xff3aa8) },
      },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main(){
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vN; varying vec3 vV;
        uniform vec3 uColor, uRim, uRim2;
        void main(){
          float fres = pow(1.0 - max(dot(vN,vV),0.0), 2.2);
          float fres2 = pow(1.0 - max(dot(vN,vV),0.0), 5.0);
          vec3 col = uColor + uRim*fres*0.55 + uRim2*fres2*0.25;
          gl_FragColor = vec4(col, 0.96);
        }
      `,
    });
    const planet = new THREE.Mesh(planetGeom, planetMat);
    planet.position.set(0.6, -3.1, 0);
    scene.add(planet);

    // Particles
    const PCOUNT = 9000;
    const pPos = new Float32Array(PCOUNT * 3);
    const pCol = new Float32Array(PCOUNT * 3);
    const tmp = new THREE.Vector3();

    for (let i = 0; i < PCOUNT; i++) {
      const u = Math.random(),
        v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.PI * 0.25 + v * Math.PI * 0.4;
      const r = 3.92;
      tmp.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      pPos[i * 3] = tmp.x;
      pPos[i * 3 + 1] = tmp.y;
      pPos[i * 3 + 2] = tmp.z;

      const t = Math.random();
      const c1 = new THREE.Color("#6b5cff");
      const c2 = new THREE.Color("#ff3aa8");
      const c3 = new THREE.Color("#ff3b3b");
      const cc =
        t < 0.6
          ? c1.clone().lerp(c2, t / 0.6)
          : c2.clone().lerp(c3, (t - 0.6) / 0.4);
      pCol[i * 3] = cc.r;
      pCol[i * 3 + 1] = cc.g;
      pCol[i * 3 + 2] = cc.b;
    }

    const pointsGeom = new THREE.BufferGeometry();
    pointsGeom.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pointsGeom.setAttribute("color", new THREE.BufferAttribute(pCol, 3));

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(-999, -999, -999) },
        uSize: { value: 16.0 * renderer.getPixelRatio() },
        uOpacity: { value: 0.95 },
      },
      vertexShader: `
        uniform float uTime, uSize;
        uniform vec3 uMouse;
        attribute vec3 color;
        varying vec3 vColor;
        void main(){
          vColor = color;
          vec3 pos = position;
          pos.x += sin(uTime*0.8+pos.y*2.0)*0.04;
          pos.y += cos(uTime*0.7+pos.z*2.0)*0.04;
          pos.z += sin(uTime*0.9+pos.x*2.0)*0.04;
          vec4 worldPos = modelMatrix * vec4(pos,1.0);
          float dist = distance(worldPos.xyz, uMouse);
          float radius = 3.0;
          if(dist < radius){
            vec3 dir = normalize(worldPos.xyz - uMouse);
            float force = pow((radius-dist)/radius, 1.8);
            worldPos.xyz += dir * force * 0.6;
          }
          vec4 mvPosition = viewMatrix * worldPos;
          gl_PointSize = uSize * (1.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        void main(){
          vec2 coord = gl_PointCoord - vec2(0.5);
          if(length(coord) > 0.5) discard;
          gl_FragColor = vec4(vColor, uOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const dust = new THREE.Points(pointsGeom, pointsMat);
    dust.position.copy(planet.position);
    scene.add(dust);

    // Arc lines
    const arcs: { curve: THREE.QuadraticBezierCurve3; line: THREE.Line }[] = [];
    const travelers: THREE.Mesh[] = [];

    function makeGlowSprite() {
      const geom = new THREE.SphereGeometry(0.05, 16, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      return new THREE.Mesh(geom, mat);
    }

    const endpoints: [THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(-3.6, -1.2, 0.4), new THREE.Vector3(3.2, -1.0, 0.9), 1.8],
      [new THREE.Vector3(-4.0, -1.4, 0.2), new THREE.Vector3(2.2, -0.6, -0.3), 2.4],
      [new THREE.Vector3(-2.8, -0.8, 1.2), new THREE.Vector3(4.0, -1.4, 0.1), 1.4],
      [new THREE.Vector3(-3.8, -1.0, -0.8), new THREE.Vector3(3.6, -0.8, -0.6), 2.0],
    ];

    endpoints.forEach((e, idx) => {
      const mid = e[0].clone().add(e[1]).multiplyScalar(0.5);
      mid.y += e[2];
      const curve = new THREE.QuadraticBezierCurve3(e[0], mid, e[1]);
      const pts = curve.getPoints(180);
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: idx % 2 === 0 ? 0xff3aa8 : 0x7c5cff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(g, mat);
      line.renderOrder = 5;
      scene.add(line);
      arcs.push({ curve, line });

      const t = makeGlowSprite();
      (t.material as THREE.MeshBasicMaterial).color.set(
        idx % 2 === 0 ? 0xfff2ff : 0xdbe7ff
      );
      t.scale.setScalar(idx === 1 ? 1.4 : 1.0);
      t.userData.speed = 0.08 + Math.random() * 0.06;
      t.userData.u = Math.random();
      scene.add(t);
      travelers.push(t);
    });

    // Stars
    const STAR = 900;
    const sPos = new Float32Array(STAR * 3);
    for (let i = 0; i < STAR; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 28;
      sPos[i * 3 + 1] = (Math.random() - 0.2) * 18;
      sPos[i * 3 + 2] = -10 - Math.random() * 30;
    }
    const sGeom = new THREE.BufferGeometry();
    sGeom.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    const stars = new THREE.Points(
      sGeom,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.02,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    scene.add(stars);

    // Mouse interaction
    const mouse = new THREE.Vector2(-999, -999);
    const raycaster = new THREE.Raycaster();
    const plane2 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const dummyTarget = new THREE.Vector3();

    const onMouseMove = (ev: MouseEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onMouseLeave = () => mouse.set(-999, -999);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    const t0 = performance.now();
    let raf: number;

    function animate(now: number) {
      if (!prefersReduced) {
        const t = (now - t0) / 1000;

        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.ray.intersectPlane(plane2, dummyTarget);
        if (hit && mouse.x !== -999) {
          pointsMat.uniforms.uMouse.value.lerp(dummyTarget, 0.08);
        } else {
          pointsMat.uniforms.uMouse.value.lerp(
            new THREE.Vector3(-999, -999, -999),
            0.05
          );
        }

        pointsMat.uniforms.uTime.value = t;
        pointsMat.uniforms.uOpacity.value = 0.88 + 0.1 * Math.sin(t * 0.9);

        dust.rotation.y = t * 0.04;
        dust.rotation.z = t * 0.015;

        const sPositions = stars.geometry.attributes.position
          .array as Float32Array;
        for (let i = 0; i < STAR; i++) {
          sPositions[i * 3 + 2] += 0.015;
          if (sPositions[i * 3 + 2] > 6) sPositions[i * 3 + 2] = -30;
        }
        stars.geometry.attributes.position.needsUpdate = true;

        camera.position.x = 0.12 * Math.sin(t * 0.18);
        camera.position.y = 1.2 + 0.06 * Math.cos(t * 0.2);
        camera.lookAt(0.2, -0.6, 0);

        arcs.forEach(
          (a, i) =>
            ((a.line.material as THREE.LineBasicMaterial).opacity =
              0.68 + 0.22 * Math.sin(t * 0.8 + i))
        );

        travelers.forEach((tr, i) => {
          tr.userData.u = (tr.userData.u + tr.userData.speed * 0.016) % 1;
          const p = arcs[i].curve.getPoint(tr.userData.u);
          tr.position.copy(p);
          const s = 0.9 + 0.35 * Math.sin(t * 3.2 + i);
          tr.scale.setScalar(s * (i === 1 ? 1.4 : 1.0));
          (tr.material as THREE.MeshBasicMaterial).opacity =
            0.65 + 0.35 * Math.sin(t * 2.6 + i);
        });
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="motion-reduce:hidden absolute inset-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
