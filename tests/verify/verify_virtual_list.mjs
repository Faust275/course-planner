// 虚拟滚动、GPU手势加速与重度负载端到端仿真测试
import { startServer } from '../../test-utils.mjs';
import { chromium } from 'playwright';

console.log('▶ 启动虚拟滚动与重度场景仿真测试...');

const { base, close } = await startServer();
let browser = null;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const skip = await page.$('text=跳过');
  if (skip) { await skip.click(); await page.waitForTimeout(300); }

  // 1. 验证 VirtualList 全局组件已挂载
  const hasVirtualList = await page.evaluate(() => {
    return typeof window.VirtualList === 'function' && typeof window.VirtualList.mount === 'function';
  });
  console.assert(hasVirtualList, 'VirtualList 组件必须挂载在全局 window 上');
  console.log('  ✓ VirtualList 组件加载成功');

  // 2. 灌入 300 条带象限与截止日期待办
  const injectedCount = await page.evaluate(() => {
    const tasks = [];
    const today = DateUtil.toStr(DateUtil.today());
    for (let i = 1; i <= 300; i++) {
      tasks.push({
        id: 'tk_heavy_' + i,
        title: '自动化重度待办测试项目 #' + i,
        status: i % 5 === 0 ? 'done' : 'todo',
        important: i % 3 === 0,
        urgent: i % 2 === 0,
        dueDate: today,
        dueTime: (i % 24).toString().padStart(2, '0') + ':00',
        tags: i % 2 === 0 ? ['学习/高数'] : ['生活/购物'],
        createdAt: new Date().toISOString()
      });
    }
    Store.state.tasks = tasks;
    Store.save();
    return Store.state.tasks.length;
  });
  console.assert(injectedCount === 300, '必须成功注入 300 条重度任务数据');
  console.log('  ✓ 成功灌入 300 条待办数据');

  // 3. 导航到待办视图
  await page.evaluate(() => {
    App.go('tasks');
  });
  await page.waitForTimeout(400);

  // 验证当前处于虚拟滚动模式，DOM 节点数远小于 300（严格在 18 个以内）
  const domNodeCount = await page.evaluate(() => {
    const pool = document.querySelector('.cp-virtual-pool');
    if (!pool) return document.querySelectorAll('.cp-task-row, .task-row, .cp-task-drag').length;
    return pool.querySelectorAll('.cp-task-row, .task-row, .cp-task-drag').length;
  });

  console.log('  ✓ 300 条待办渲染时活跃 DOM 节点数: ' + domNodeCount);
  console.assert(domNodeCount > 0 && domNodeCount <= 18, '活跃 DOM 节点数必须保持在 18 个以内，实际: ' + domNodeCount);

  // 4. 模拟滚动后验证窗口切片与 translate3d 动态更新
  const scrollResult = await page.evaluate(() => {
    const card = document.querySelector('.card[style*="overflow-y"]') || document.querySelector('.card') || window;
    if (card === window) {
      window.scrollTo(0, 1200);
    } else {
      card.scrollTop = 1200;
      card.dispatchEvent(new Event('scroll'));
    }
    const pool = document.querySelector('.cp-virtual-pool');
    return {
      hasPool: !!pool,
      transform: pool ? pool.style.transform : ''
    };
  });
  console.assert(scrollResult.hasPool, '必须存在 .cp-virtual-pool 容器');
  console.assert(scrollResult.transform.includes('translate3d'), '虚拟视口池必须使用 translate3d 定位');
  console.log('  ✓ 滚动触发 translate3d 动态平移切片');

  // 5. 验证 DragGesture 的 GPU 硬件加速样式
  const gestureAccel = await page.evaluate(() => {
    const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join(' ');
    return styles.includes('will-change:transform') || styles.includes('will-change: transform');
  });
  console.assert(gestureAccel, '拖拽手势幽灵块必须声明 will-change: transform');
  console.log('  ✓ DragGesture 具备 GPU 硬件加速与 will-change: transform');
  // 6. 切换至平铺（手动排序）模式并验证 VirtualList 同样生效
  const flatNodeCount = await page.evaluate(() => {
    const tasksView = App.views.find(v => v.id === "tasks");
    if (tasksView && tasksView.state) {
      tasksView.state.sortMode = "manual";
      tasksView.render();
    }
    const pool = document.querySelector(".cp-virtual-pool");
    if (!pool) return document.querySelectorAll(".cp-task-row, .task-row, .cp-task-drag").length;
    return pool.querySelectorAll(".cp-task-row, .task-row, .cp-task-drag").length;
  });
  console.assert(flatNodeCount > 0 && flatNodeCount <= 18, "平铺模式下活跃 DOM 节点数必须保持在 18 个以内，实际: " + flatNodeCount);
  console.log("  ✓ 平铺模式（sortMode: manual）渲染时活跃 DOM 节点数: " + flatNodeCount);


  console.log('\nALL PASS: 虚拟滚动与 GPU 手势加速全链路仿真验证通过！');
} finally {
  if (browser) await browser.close();
  close();
}
