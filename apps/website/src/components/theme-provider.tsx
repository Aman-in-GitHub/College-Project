import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

function ThemeProvider(props: ThemeProviderProps) {
  return <NextThemesProvider {...props} />;
}

export { ThemeProvider };
