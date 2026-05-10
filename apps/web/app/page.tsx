import { TopNav } from "@/components/top-nav";
import { Hero } from "@/components/hero";
import { IntroStrip } from "@/components/intro-strip";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <TopNav />
      <Hero />
      <IntroStrip />
      <Footer />
    </>
  );
}
