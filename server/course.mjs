// Tracks which course.yaml is currently loaded for the GET /api/course endpoint.
// Set by the load route; resets when a new course is loaded.

import { parseYaml } from "./yaml.mjs";
import { validateCourse, publicLevel } from "../shared/course-schema.mjs";
import { readFile } from "node:fs/promises";

let current = null; // { meta, levels } — already validated and stripped

export function setCurrentCourse(course) {
  current = course;
}

export function getCurrentCourse() {
  return current;
}

export function clearCurrentCourse() {
  current = null;
}

// Load a course from a YAML file path.
export async function loadFromPath(filePath) {
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  const result = validateCourse(parsed);
  if (!result.ok) throw new Error(`Invalid course: ${result.errors.join("; ")}`);
  return result.value;
}

// Serve the current course's public view.
export async function getCoursePublic() {
  if (!current) return null;
  return {
    meta: current.meta,
    levels: current.levels.map((l) => ({
      id: l.id,
      title: l.title,
      emoji: l.emoji,
      description: l.description,
      hasVideo: Boolean(l.video),
      quizCount: l.quiz.length,
      blockCount: (l.blocks || []).length,
      hasCode: Boolean(l.code),
    })),
  };
}

export async function getLevelPublic(levelId) {
  if (!current) return null;
  const level = current.levels.find((l) => l.id === levelId);
  if (!level) return null;
  return publicLevel(level);
}

export async function getLevelWithKeys(levelId) {
  if (!current) return null;
  return current.levels.find((l) => l.id === levelId) || null;
}

export async function buildAvatarSystemPrompt(levelId) {
  if (!current) return "You are an AI tutor.";
  const meta = current.meta;
  const level = current.levels.find((l) => l.id === levelId) || null;
  const persona = level?.avatarPrompt
    ? `${meta.avatar.prompt}\n\nLevel context: ${level.avatarPrompt}`
    : meta.avatar.prompt;
  const lines = [
    persona,
    "",
    `Course: ${meta.title} (${meta.id})`,
    `Current level: ${level ? `${level.emoji} ${level.title}` : "overview"}`,
    "",
    "Coach with hints and questions — never hand over the full answer.",
  ];
  return lines.filter(Boolean).join("\n");
}