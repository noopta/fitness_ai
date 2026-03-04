import { useEffect } from "react";

export default function Landing() {
  useEffect(() => {
    window.location.replace("/signup");
  }, []);

  return <div className="page" data-testid="redirect-signup" />;
}
