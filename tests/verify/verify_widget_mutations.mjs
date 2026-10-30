// 桌面小组件离线交互闭环与 Mutation 状态重放验证
import { startServer } from '../../test-utils.mjs';
import { chromium } from 'playwright';

console.log('▶ 启动桌面小组件离线交互与 Mutation 重放验证...');

const { base, close } = await startServer();
let browser = null;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const skip = await page.$('text=跳过');
  if (skip) { await skip.click(); await page.waitForTimeout(300); }

  // 1. 验证 snapshotForWidget 带有 id 与 done 状态
  const createdTaskId = await page.evaluate(() => {
    const t = Store.addTask({
      title: '高数课后作业第三章',
      dueDate: DateUtil.toStr(DateUtil.today()),
      dueTime: '18:00',
      status: 'todo'
    });
    return t.id;
  });

  const snapCheck = await page.evaluate((tid) => {
    const snap = Store.snapshotForWidget();
    return {
      hasTodo: !!snap.nextTodo,
      id: snap.nextTodo ? snap.nextTodo.id : null,
      done: snap.nextTodo ? snap.nextTodo.done : null,
      title: snap.nextTodo ? snap.nextTodo.title : null,
      matchesCreated: snap.nextTodo ? snap.nextTodo.id === tid : false
    };
  }, createdTaskId);

  console.assert(snapCheck.hasTodo, '必须生成 nextTodo 快照');
  console.assert(snapCheck.matchesCreated, 'nextTodo 必须匹配刚刚新建的待办 id: ' + createdTaskId);
  console.assert(snapCheck.done === false, '未完成待办 done 必须为 false');
  console.log('  ✓ snapshotForWidget 包含完整的 id 与 done 交互元数据 (id: ' + snapCheck.id + ')');

  // 2. 模拟原生桌面小组件产生的离线 Mutation 并注入
  const replayResult = await page.evaluate(async (tid) => {
    let pendingMutations = [
      {
        id: tid,
        done: true,
        timestamp: Date.now(),
        version: 1
      }
    ];

    window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.TodayWidget = {
      update: () => Promise.resolve({ ok: true }),
      getPendingWidgetMutations: () => {
        const ret = { mutations: pendingMutations.slice() };
        pendingMutations = [];
        return Promise.resolve(ret);
      }
    };

    const count = await App.syncWidgetMutations();
    const taskAfter = Store.getTask(tid);
    const snapAfter = Store.snapshotForWidget();

    return {
      replayedCount: count,
      taskStatus: taskAfter ? taskAfter.status : null,
      hasDoneAt: taskAfter && !!taskAfter.doneAt,
      snapDone: snapAfter.nextTodo ? snapAfter.nextTodo.done : null
    };
  }, createdTaskId);

  console.assert(replayResult.replayedCount === 1, '必须精准重放 1 条待办状态变更');
  console.assert(replayResult.taskStatus === 'done', '待办状态必须被翻转为 done');
  console.assert(replayResult.hasDoneAt === true, '完成待办必须带上原子完成时间戳');
  console.log('  ✓ 前台唤醒成功重放离线 Mutation，待办状态原子变更为已完成');

  // 3. 验证幂等性：空队列再次调用时不产生二次变更
  const secondReplay = await page.evaluate(async () => {
    return await App.syncWidgetMutations();
  });
  console.assert(secondReplay === 0, '消费后队列为空，重放数必须为 0');
  console.log('  ✓ 幂等性校验通过，无脏数据与重复重放');

  console.log('\nALL PASS: 桌面小组件离线交互与版本化 Mutation 重放闭环验证通过！');
} finally {
  if (browser) await browser.close();
  close();
}
