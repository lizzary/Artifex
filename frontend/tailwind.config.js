/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                surface: {
                    primary: 'rgb(var(--clr-surface-1) / <alpha-value>)',
                    secondary: 'rgb(var(--clr-surface-2) / <alpha-value>)',
                    tertiary: 'rgb(var(--clr-surface-3) / <alpha-value>)',
                },
                content: {
                    primary: 'rgb(var(--clr-text-1) / <alpha-value>)',
                    secondary: 'rgb(var(--clr-text-2) / <alpha-value>)',
                    tertiary: 'rgb(var(--clr-text-3) / <alpha-value>)',
                    muted: 'rgb(var(--clr-text-muted) / <alpha-value>)',
                    inverse: 'rgb(var(--clr-text-inv) / <alpha-value>)',
                },
                edge: {
                    primary: 'rgb(var(--clr-edge-1) / <alpha-value>)',
                    secondary: 'rgb(var(--clr-edge-2) / <alpha-value>)',
                    subtle: 'rgb(var(--clr-edge-sub) / <alpha-value>)',
                },
                accent: {
                    DEFAULT: 'rgb(var(--clr-accent) / <alpha-value>)',
                    hover: 'rgb(var(--clr-accent-hover) / <alpha-value>)',
                },
                danger: {
                    DEFAULT: 'rgb(var(--clr-danger) / <alpha-value>)',
                    hover: 'rgb(var(--clr-danger-hover) / <alpha-value>)',
                },
                success: {
                    DEFAULT: 'rgb(var(--clr-success) / <alpha-value>)',
                },
                overlay: {
                    DEFAULT: 'rgb(var(--clr-overlay) / <alpha-value>)',
                },
            },
        },
    },
    plugins: [],
};
