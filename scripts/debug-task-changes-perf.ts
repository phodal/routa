/**
 * Performance debugging script for /api/tasks/[taskId]/changes endpoint
 */
import { getRoutaSystem } from "@/core/routa-system";
import { getRepoChanges, isBareGitRepository, isGitRepository } from "@/core/git/git-utils";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";
import { getRepoCommitChanges } from "@/core/git";

async function debugTaskChangesPerformance(taskId: string) {
  console.log(`\n🔍 Performance Analysis for Task: ${taskId}\n`);
  
  const startTotal = Date.now();
  
  // Step 1: Get task
  console.log("⏱️  Step 1: Getting task...");
  const startTask = Date.now();
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  console.log(`   ✓ Took ${Date.now() - startTask}ms`);
  
  if (!task) {
    console.log("❌ Task not found");
    return;
  }
  
  // Step 2: Get worktree
  console.log("⏱️  Step 2: Getting worktree...");
  const startWorktree = Date.now();
  const worktree = task.worktreeId
    ? await system.worktreeStore.get(task.worktreeId)
    : null;
  console.log(`   ✓ Took ${Date.now() - startWorktree}ms`);
  
  // Step 3: Get codebase
  console.log("⏱️  Step 3: Getting codebase...");
  const startCodebase = Date.now();
  const codebaseId = worktree?.codebaseId ?? task.codebaseIds?.[0] ?? "";
  const codebase = codebaseId ? await system.codebaseStore.get(codebaseId) : null;
  const repoPath = worktree?.worktreePath ?? codebase?.repoPath ?? "";
  console.log(`   ✓ Took ${Date.now() - startCodebase}ms`);
  console.log(`   📁 Repo path: ${repoPath}`);
  
  if (!repoPath) {
    console.log("❌ No repo path");
    return;
  }
  
  // Step 4: Check if git repo
  console.log("⏱️  Step 4: Checking if git repository...");
  const startGitCheck = Date.now();
  const isGit = isGitRepository(repoPath);
  console.log(`   ✓ Took ${Date.now() - startGitCheck}ms - Is Git: ${isGit}`);
  
  if (!isGit) {
    console.log("❌ Not a git repository");
    return;
  }
  
  // Step 5: Check if bare repo
  console.log("⏱️  Step 5: Checking if bare repository...");
  const startBareCheck = Date.now();
  const isBare = isBareGitRepository(repoPath);
  console.log(`   ✓ Took ${Date.now() - startBareCheck}ms - Is Bare: ${isBare}`);
  
  // Step 6: Get repo changes
  console.log("⏱️  Step 6: Getting repo changes...");
  const startChanges = Date.now();
  const changes = getRepoChanges(repoPath);
  const changesTime = Date.now() - startChanges;
  console.log(`   ✓ Took ${changesTime}ms`);
  console.log(`   📊 Files: ${changes.files.length}, Branch: ${changes.branch}`);
  
  // Step 7: Build delivery readiness
  console.log("⏱️  Step 7: Building task delivery readiness...");
  const startReadiness = Date.now();
  const deliveryReadiness = await buildTaskDeliveryReadiness(task, system);
  const readinessTime = Date.now() - startReadiness;
  console.log(`   ✓ Took ${readinessTime}ms`);
  console.log(`   📋 Checked: ${deliveryReadiness.checked}`);
  console.log(`   📋 Base ref: ${deliveryReadiness.baseRef}`);
  console.log(`   📋 Commits since base: ${deliveryReadiness.commitsSinceBase}`);
  console.log(`   📋 Has commits: ${deliveryReadiness.hasCommitsSinceBase}`);
  
  // Step 8: Get committed changes
  console.log("⏱️  Step 8: Getting repo commit changes...");
  const startCommits = Date.now();
  const committedChanges = deliveryReadiness.checked
    && deliveryReadiness.hasCommitsSinceBase
    && deliveryReadiness.baseRef
    ? getRepoCommitChanges(repoPath, {
        baseRef: deliveryReadiness.baseRef,
        maxCount: Math.max(deliveryReadiness.commitsSinceBase, 1),
      })
    : [];
  const commitsTime = Date.now() - startCommits;
  console.log(`   ✓ Took ${commitsTime}ms`);
  console.log(`   📊 Commits: ${committedChanges.length}`);
  
  const totalTime = Date.now() - startTotal;
  console.log(`\n⏱️  TOTAL TIME: ${totalTime}ms\n`);
  
  // Performance summary
  console.log("📊 Performance Breakdown:");
  console.log(`   Repo changes:        ${changesTime}ms  ${changesTime > 5000 ? '🔥 SLOW!' : changesTime < 1000 ? '✅ FAST!' : '⚠️'}`);
  console.log(`   Delivery readiness:  ${readinessTime}ms  ${readinessTime > 1000 ? '⚠️ ' : '✅'}`);
  console.log(`   Commit changes:      ${commitsTime}ms  ${commitsTime > 1000 ? '⚠️ ' : '✅'}`);
  
  if (changesTime > 10000) {
    console.log("\n🔥 CRITICAL SLOWNESS DETECTED!");
    console.log(`   - getRepoChanges took ${(changesTime / 1000).toFixed(1)}s`);
    console.log(`   - Processing ${changes.files.length} files`);
  } else if (changesTime < 2000) {
    console.log("\n✅ EXCELLENT PERFORMANCE!");
    console.log(`   - Processed ${changes.files.length} files in ${(changesTime / 1000).toFixed(2)}s`);
    console.log(`   - That's ~${(changesTime / changes.files.length).toFixed(1)}ms per file`);
  }
}

const taskId = process.argv[2] || "03ee3456-9df2-43df-bd28-60df023e99f1";
debugTaskChangesPerformance(taskId).catch(console.error);
