"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useInView } from "motion/react";

export type SiteTheme = "brand" | "dark" | "light";

export function ThemeSection({
  theme,
  navTheme,
  id,
  className,
  style,
  children,
}: {
  theme: SiteTheme;
  navTheme?: SiteTheme;
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const atCentre = useInView(ref, { margin: "-50% 0px -50% 0px" });
  const underNav = useInView(ref, { margin: "0px 0px -94% 0px" });
  useEffect(() => {
    if (atCentre) document.documentElement.dataset.theme = theme;
  }, [atCentre, theme]);
  useEffect(() => {
    if (underNav) document.documentElement.dataset.navTheme = navTheme ?? theme;
  }, [underNav, theme, navTheme]);
  return (
    <section ref={ref} id={id} className={className} style={style} data-theme-to={theme}>
      {children}
    </section>
  );
}
