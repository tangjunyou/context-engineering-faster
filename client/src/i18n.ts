import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enCommon from "./locales/en/common";
import zhCommon from "./locales/zh/common";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ["en", "zh"],
    fallbackLng: "zh",
    defaultNS: "common",
    ns: ["common"],
    resources: {
      en: { common: enCommon },
      zh: { common: zhCommon },
    },
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      caches: ["localStorage"],
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
