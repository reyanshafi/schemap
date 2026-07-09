export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[13px] font-bold text-white">
        S
      </span>
      Schemap
    </span>
  );
}
