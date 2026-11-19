/**
 * One of the show's own videos (video/, rendered on the Mac and kept in public/press/video), as a player: the poster
 * first, nothing loaded until it's played, never autoplaying, sound off until the viewer turns it on.
 */
export type Promo = { src: string; poster: string; width: number; height: number; label: string };

export default function PromoVideo({ video, className }: { video: Promo; className?: string }) {
  return (
    <video
      className={className ? `promo-video ${className}` : "promo-video"}
      controls
      playsInline
      preload="none"
      poster={video.poster}
      width={video.width}
      height={video.height}
      aria-label={video.label}
    >
      <source src={video.src} type="video/mp4" />
    </video>
  );
}
