import { useEffect, useRef } from "react";

const MARKUP = `<svg viewBox="420 240 840 400" preserveAspectRatio="xMidYMid meet" class="scene-svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="screenGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9fb4e8" stop-opacity="0.35"/><stop offset="100%" stop-color="#9fb4e8" stop-opacity="0"/></radialGradient>
    <linearGradient id="deskTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2b2f36"/><stop offset="100%" stop-color="#15171b"/></linearGradient>
    <linearGradient id="lid" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a3f47"/><stop offset="100%" stop-color="#1c1f24"/></linearGradient>
    <radialGradient id="shadow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#000" stop-opacity="0.18"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient>
    <clipPath id="screenClip"><rect x="826" y="294" width="276" height="166" rx="4"/></clipPath>
  </defs>
  <ellipse cx="800" cy="606" rx="560" ry="40" fill="url(#shadow)"/>
  <rect x="630" y="486" width="116" height="10" rx="5" fill="#1a1d22"/>
  <rect x="682" y="496" width="10" height="92" fill="#15171b"/>
  <rect x="644" y="588" width="88" height="6" rx="3" fill="#15171b"/>
  <g>
    <animateTransform id="walk" attributeName="transform" type="translate"
      values="110 590; 672 590; 688 590; 688 554; 688 554" keyTimes="0; 0.26; 0.32; 0.38; 1"
      calcMode="spline" keySplines="0.33 0 0.2 1; 0.4 0 0.6 1; 0.33 0 0.2 1; 0 0 1 1"
      dur="14s" repeatCount="indefinite"/>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 0; 0 -4; 0 0" dur="0.62s" repeatCount="6" begin="walk.begin; walk.repeatEvent" fill="remove"/>
      <g><rect x="-40" y="-164" width="15" height="84" rx="7" fill="#1e2126"/>
        <animateTransform attributeName="transform" type="rotate" values="22 -32 -160; -22 -32 -160; 22 -32 -160" dur="0.62s" repeatCount="6" begin="walk.begin; walk.repeatEvent" fill="remove"/></g>
      <g><rect x="-24" y="-68" width="18" height="76" rx="7" fill="#1e2126"/>
        <animateTransform attributeName="transform" type="rotate" values="-22 -15 -68; 22 -15 -68; -22 -15 -68" dur="0.62s" repeatCount="6" begin="walk.begin; walk.repeatEvent" fill="remove"/></g>
      <circle cx="0" cy="-196" r="26" fill="#23262c"/>
      <path d="M -30 -168 Q 0 -178 30 -168 L 26 -64 L -26 -64 Z" fill="#23262c"/>
      <g><rect x="6" y="-68" width="18" height="76" rx="7" fill="#2c3037"/>
        <animateTransform attributeName="transform" type="rotate" values="22 15 -68; -22 15 -68; 22 15 -68" dur="0.62s" repeatCount="6" begin="walk.begin; walk.repeatEvent" fill="remove"/></g>
      <g><rect x="25" y="-164" width="15" height="84" rx="7" fill="#2c3037"/>
        <animateTransform attributeName="transform" type="rotate" values="-22 32 -160; 22 32 -160; -22 32 -160" dur="0.62s" repeatCount="6" begin="walk.begin; walk.repeatEvent" fill="remove"/></g>
    </g>
  </g>
  <rect x="460" y="456" width="690" height="14" rx="3" fill="url(#deskTop)"/>
  <rect x="500" y="470" width="10" height="126" fill="#15171b"/>
  <rect x="1100" y="470" width="10" height="126" fill="#15171b"/>
  <rect x="812" y="446" width="304" height="12" rx="4" fill="#23262c"/>
  <rect x="824" y="442" width="280" height="6" rx="2" fill="#2e323a"/>
  <g transform="translate(964 468)">
    <g transform="scale(1 0.04)">
      <animateTransform attributeName="transform" type="scale" values="1 0.04; 1 0.04; 1 1.02; 1 1; 1 1" keyTimes="0; 0.36; 0.46; 0.49; 1"
        calcMode="spline" keySplines="0 0 1 1; 0.2 0 0.1 1; 0.4 0 0.6 1; 0 0 1 1" dur="14s" repeatCount="indefinite" begin="walk.begin"/>
      <g transform="translate(-964 -468)">
        <rect x="818" y="286" width="292" height="182" rx="8" fill="url(#lid)"/>
        <rect x="826" y="294" width="276" height="166" rx="4" fill="#050608"/>
        <g clip-path="url(#screenClip)">
          <rect x="826" y="294" width="276" height="166" fill="#07080b"/>
          <rect x="826" y="294" width="276" height="16" fill="#0d0f13"/>
          <circle cx="838" cy="302" r="3" fill="#2f333b"/><circle cx="850" cy="302" r="3" fill="#2f333b"/><circle cx="862" cy="302" r="3" fill="#2f333b"/>
          <text x="836" y="330" class="t t1" opacity="0">$ vibekit sprint run<set attributeName="opacity" to="0" begin="walk.begin; walk.repeatEvent"/><set attributeName="opacity" to="1" begin="walk.begin+7.3s; walk.repeatEvent+7.3s"/></text>
          <text x="836" y="350" class="t t2" opacity="0">Sprint 3 · 5 items ready · 2 lanes<set attributeName="opacity" to="0" begin="walk.begin; walk.repeatEvent"/><set attributeName="opacity" to="1" begin="walk.begin+7.8s; walk.repeatEvent+7.8s"/></text>
          <rect x="836" y="360" width="0" height="8" rx="2" fill="#4ade9d"><set attributeName="width" to="0" begin="walk.begin; walk.repeatEvent"/><animate attributeName="width" from="0" to="190" dur="2.4s" begin="walk.begin+8.3s; walk.repeatEvent+8.3s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.2 1"/></rect>
          <text x="836" y="382" class="t" opacity="0">Creating a list<set attributeName="opacity" to="0" begin="walk.begin; walk.repeatEvent"/><set attributeName="opacity" to="1" begin="walk.begin+8.3s; walk.repeatEvent+8.3s"/></text>
          <rect x="836" y="392" width="0" height="8" rx="2" fill="#4ade9d"><set attributeName="width" to="0" begin="walk.begin; walk.repeatEvent"/><animate attributeName="width" from="0" to="150" dur="2.8s" begin="walk.begin+9.0s; walk.repeatEvent+9.0s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.2 1"/></rect>
          <text x="836" y="414" class="t" opacity="0">Marking a task done<set attributeName="opacity" to="0" begin="walk.begin; walk.repeatEvent"/><set attributeName="opacity" to="1" begin="walk.begin+9.0s; walk.repeatEvent+9.0s"/></text>
          <text x="836" y="440" class="t t2" opacity="0">2 of 5 done · R 88 spent<set attributeName="opacity" to="0" begin="walk.begin; walk.repeatEvent"/><set attributeName="opacity" to="1" begin="walk.begin+11.2s; walk.repeatEvent+11.2s"/></text>
        </g>
      </g>
    </g>
  </g>
  <ellipse cx="930" cy="400" rx="300" ry="190" fill="url(#screenGlow)" opacity="0">
    <animate attributeName="opacity" values="0; 0; 1; 0.8; 0.9; 0.9; 0" keyTimes="0; 0.44; 0.52; 0.58; 0.7; 0.96; 1" dur="14s" repeatCount="indefinite" begin="walk.begin"/>
  </ellipse>
</svg>`;

export default function LaptopScene({ reduced = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const svg = ref.current?.querySelector("svg");
    if (!svg || typeof svg.setCurrentTime !== "function") return;
    if (reduced) {
      svg.setCurrentTime(10);
      svg.pauseAnimations?.();
      return;
    }
    // The walk starts off the crop; land on the approach so the first paint has the figure.
    svg.setCurrentTime(3.1);
  }, [reduced]);

  return <div className="scene-inner" ref={ref} dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
