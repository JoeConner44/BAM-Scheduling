"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";

export type DragData =
  | { kind: "project"; projectId: string; hours: number; label: string }
  | { kind: "block"; blockId: string; label: string }
  | { kind: "assignment"; resource: "employee" | "equipment"; resourceId: string; blockId: string; label: string };

export type DropData =
  | { kind: "day"; day: string }
  | { kind: "timeline"; day: string }
  | { kind: "employee"; employeeId: string; day: string; timeline: boolean }
  | { kind: "equipment"; equipmentId: string; day: string; timeline: boolean }
  | { kind: "unschedule" };

export function Draggable({
  id,
  data,
  children,
  className,
  style,
  disabled,
}: {
  id: string;
  data: DragData;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div
      ref={setNodeRef}
      data-drag={data.kind}
      data-label={data.label}
      {...listeners}
      {...attributes}
      className={clsx(className, "touch-manipulation", isDragging && "opacity-30", !disabled && "cursor-grab active:cursor-grabbing")}
      style={style}
    >
      {children}
    </div>
  );
}

export function Droppable({
  id,
  data,
  children,
  className,
  style,
  activeClassName = "ring-2 ring-inset ring-blue-500 bg-blue-50/70",
  label,
}: {
  id: string;
  data: DropData;
  /** Human name of the row (person / equipment), used by tests and screen readers. */
  label?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  activeClassName?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      data-drop={data.kind}
      data-day={"day" in data ? data.day : undefined}
      data-label={label}
      className={clsx(className, isOver && activeClassName)}
      style={style}
    >
      {children}
    </div>
  );
}
