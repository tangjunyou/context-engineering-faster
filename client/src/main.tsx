import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import i18n from "./i18n";
import "./index.css";

const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT as string | undefined;
const analyticsWebsiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID as string | undefined;

if (analyticsEndpoint && analyticsWebsiteId) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = `${analyticsEndpoint.replace(/\/$/, "")}/umami`;
  script.dataset.websiteId = analyticsWebsiteId;
  document.head.appendChild(script);
}

createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </I18nextProvider>
);
