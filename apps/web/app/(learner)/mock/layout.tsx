import { redirect } from "next/navigation";

// The Full Mock section is temporarily hidden while its design is reworked
// (the nav item is removed in components/learner-nav.tsx and the home-page
// mock resume strip is suppressed). This layout gates every /mock route
// — picker, runner, and result — so direct URLs and stale bookmarks bounce
// to the dashboard rather than reaching a section we're not surfacing yet.
//
// To restore the section: delete this file, re-add the "Mock" nav item, and
// pass dash.resume.mockSession back into <ResumeStrip> on the home page.
export default function MockHiddenLayout() {
  redirect("/home");
}
