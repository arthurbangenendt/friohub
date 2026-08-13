"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { motion, type Variants } from "framer-motion";
import { ThermalField } from "@/components/ui/thermal-field";
import { CIDADE } from "@/lib/regiao";
import { MapPin, Search, Shield, Star, Bolt } from "@/components/icons";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay: 0.15 + i * 0.1, ease: [0.16, 1, 0.3, 1] },
  }),
};

export function Hero() {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: "max(600px, 100dvh)",
        display: "flex",
        alignItems: "center",
        background: "#050f16",
      }}
    >
      <MeshGradient
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        colors={["#050f16", "#0a3648", "#0d6e8f", "#57c3da", "#eef7fa"]}
        speed={0.25}
        distortion={0.9}
        swirl={0.3}
      />

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: 0.22,
          pointerEvents: "none",
          maskImage: "radial-gradient(120% 90% at 24% 15%, black 0%, transparent 68%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 24% 15%, black 0%, transparent 68%)",
        }}
      >
        <ThermalField />
      </div>

      <div aria-hidden className="hero-scrim" />

      <div className="container" style={{ position: "relative", zIndex: 2, padding: "96px 24px 72px" }}>
        <div style={{ maxWidth: 620 }}>
          {/* A praça sai de lib/regiao — escrever a cidade à mão aqui foi o que deixou
              "Fortaleza" no ar depois que a operação mudou para São Paulo. */}
          <motion.span className="hero-chip" custom={0} initial="hidden" animate="show" variants={fadeUp}>
            Ar-condicionado · {CIDADE}
          </motion.span>

          <motion.h1 className="hero-title" custom={1} initial="hidden" animate="show" variants={fadeUp}>
            Instalar, limpar ou consertar o seu ar
            <br />
            <span className="hero-title-accent">sem dor de cabeça.</span>
          </motion.h1>

          <motion.p className="hero-subtitle" custom={2} initial="hidden" animate="show" variants={fadeUp}>
            Instalação, manutenção, limpeza, remanejamento ou conserto — escolha o profissional certo
            para a sua casa. Se o aparelho for novo, você também compara as marcas aqui, com preço
            transparente.
          </motion.p>

          <motion.form
            action="/solicitar"
            className="hero-search"
            custom={3}
            initial="hidden"
            animate="show"
            variants={fadeUp}
          >
            <div style={{ position: "relative", flex: 1 }}>
              <span className="hero-search-icon">
                <MapPin size={19} />
              </span>
              <input name="cep" inputMode="numeric" placeholder="Digite seu CEP" className="hero-search-input" />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" style={{ gap: 8 }}>
              <Search size={18} /> Buscar
            </button>
          </motion.form>

          <motion.div className="hero-trust" custom={4} initial="hidden" animate="show" variants={fadeUp}>
            <Trust icon={<Shield size={18} />} texto="Profissionais verificados" />
            <Trust icon={<Star size={18} filled />} texto="Avaliados por especialidade" />
            <Trust icon={<Bolt size={18} />} texto="Sem taxa para orçar" />
          </motion.div>
        </div>
      </div>

      <motion.div
        className="hero-badge"
        aria-hidden
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.75, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="hero-badge-value">
          12.000 <span>BTU/h</span>
        </div>
        <div className="hero-badge-label">Recomendado para uma sala de 20 m²</div>
      </motion.div>
    </section>
  );
}

function Trust({ icon, texto }: { icon: React.ReactNode; texto: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "rgba(234,246,250,.82)", fontWeight: 500 }}>
      <span style={{ color: "#7fe0f2", display: "flex" }}>{icon}</span> {texto}
    </span>
  );
}
