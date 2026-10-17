import OrbitFSUpdateReleaseSystem from "./UpdateReleaseClient";

/** Shared nested-route layout retains live execution state across top-menu pages. */
export default function UpdateReleaseLayout({children}:{children:React.ReactNode}){
  return <>{children}<OrbitFSUpdateReleaseSystem/></>;
}
