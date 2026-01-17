import { useState, useEffect } from "react";
import Joyride, { CallBackProps, STATUS, Step } from "react-joyride";
import { useTranslation } from "react-i18next";

export function OnboardingTour() {
  const { t } = useTranslation();
  const [run, setRun] = useState(false);

  useEffect(() => {
    // Check if running in test environment to avoid interference
    if (process.env.NODE_ENV === "test") return;

    const completed = localStorage.getItem("onboarding_complete");
    if (!completed) {
      setRun(true);
    }
  }, []);

  const handleCallback = (data: CallBackProps) => {
    const { status } = data;
    if (([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)) {
      setRun(false);
      localStorage.setItem("onboarding_complete", "true");
    }
  };

  const steps: Step[] = [
    {
      target: "body",
      placement: "center",
      content: t("tour.welcome"),
      title: t("tour.welcomeTitle"),
    },
    {
      target: "#workbench-left-panel",
      content: t("tour.leftPanel"),
      title: t("tour.leftPanelTitle"),
      placement: "right",
    },
    {
      target: "#workbench-canvas",
      content: t("tour.canvas"),
      title: t("tour.canvasTitle"),
      placement: "bottom",
    },
    {
      target: "#workbench-right-panel",
      content: t("tour.rightPanel"),
      title: t("tour.rightPanelTitle"),
      placement: "left",
    },
  ];

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      showProgress
      callback={handleCallback}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: "hsl(var(--primary))",
          textColor: "hsl(var(--foreground))",
          backgroundColor: "hsl(var(--card))",
          arrowColor: "hsl(var(--card))",
        },
        buttonNext: {
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        },
        buttonBack: {
          color: "hsl(var(--muted-foreground))",
        },
      }}
      locale={{
        back: t("tour.back"),
        close: t("tour.close"),
        last: t("tour.last"),
        next: t("tour.next"),
        skip: t("tour.skip"),
      }}
    />
  );
}
