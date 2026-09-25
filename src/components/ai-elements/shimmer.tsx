"use client";

import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type ShimmerProps = {
	children: string;
	className?: string;
	duration?: number;
	spread?: number;
};

export function Shimmer({
	children,
	className,
	duration = 2,
	spread = 2,
}: ShimmerProps) {
	const reduceMotion = useReducedMotion();
	const style = {
		"--spread": `${children.length * spread}px`,
		backgroundImage:
			"var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
	} satisfies CSSProperties & { "--spread": string };
	if (reduceMotion) {
		return (
			<span className={cn("text-muted-foreground", className)}>{children}</span>
		);
	}

	return (
		<LazyMotion features={domAnimation}>
			<m.span
				animate={{ backgroundPosition: "0% center" }}
				className={cn(
					"relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
					"[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
					className,
				)}
				initial={{ backgroundPosition: "100% center" }}
				style={style}
				transition={{
					duration,
					ease: "linear",
					repeat: Number.POSITIVE_INFINITY,
				}}
			>
				{children}
			</m.span>
		</LazyMotion>
	);
}
