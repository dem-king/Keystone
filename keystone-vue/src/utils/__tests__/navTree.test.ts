import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNavGroups, groupOfPaths, navLeaves, type MenuNode, type NavTreeOptions } from '../navTree.ts'

const KNOWN = new Set(['system/user/index', 'system/role/index', 'system/dict/index'])

const opt: NavTreeOptions = {
  routeNameOf: (p: string) => p.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'home',
  hasComponent: (c: string) => KNOWN.has(c),
  normalizePath: (p?: string) => (!p ? '' : p.startsWith('/') ? p : `/${p}`),
}

test('无子菜单的顶层节点成为 single 分组', () => {
  const groups = buildNavGroups([{ id: 1, name: '工作台', path: '/dashboard', component: 'system/user/index' }], opt)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].single, true)
  assert.equal(groups[0].items[0].path, '/dashboard')
})

test('纯目录的子菜单提升一层，目录名作为分组标题', () => {
  const tree: MenuNode[] = [{
    id: 10, name: '系统管理', path: '/system',
    children: [
      { id: 11, name: '用户管理', path: '/system/user', component: 'system/user/index' },
      { id: 12, name: '角色管理', path: '/system/role', component: 'system/role/index' },
    ],
  }]
  const groups = buildNavGroups(tree, opt)
  assert.equal(groups[0].label, '系统管理')
  assert.equal(groups[0].single, undefined)
  assert.deepEqual(groups[0].items.map(i => i.label), ['用户管理', '角色管理'],
    '纯目录的子菜单应摊平为组内项，不额外包一层分支节点')
})

test('三级菜单完整保留，不再被截断', () => {
  const tree: MenuNode[] = [{
    id: 100, name: '商城', path: '/shop',
    children: [{
      id: 101, name: '商品中心', path: '/shop/product',
      children: [
        { id: 102, name: '商品列表', path: '/shop/product/list', component: 'system/user/index' },
        { id: 103, name: '分类管理', path: '/shop/product/category', component: 'system/dict/index' },
      ],
    }],
  }]
  const groups = buildNavGroups(tree, opt)
  const product = groups[0].items[0]
  assert.equal(product.label, '商品中心')
  assert.equal(product.path, '', '纯目录不应产生可点击路径')
  assert.equal(product.children?.length, 2)
  assert.deepEqual(navLeaves(groups).map(l => l.path), ['/shop/product/list', '/shop/product/category'])
})

test('既是页面又有子菜单的节点，自身可点击并携带 children', () => {
  const tree: MenuNode[] = [{
    id: 200, name: '订单', path: '/order', component: 'system/user/index',
    children: [{ id: 201, name: '订单列表', path: '/order/list', component: 'system/role/index' }],
  }]
  const groups = buildNavGroups(tree, opt)
  const order = groups[0].items[0]
  assert.equal(order.path, '/order', '父级自身是页面时应保留可点击路径')
  assert.equal(order.children?.length, 1)
  assert.deepEqual(navLeaves(groups).map(l => l.path), ['/order', '/order/list'])
})

test('未登记组件的节点不可点击，但其子树仍被保留', () => {
  const tree: MenuNode[] = [{
    id: 300, name: '未知目录', path: '/unknown',
    children: [{ id: 301, name: '子页面', path: '/unknown/child', component: 'system/user/index' }],
  }]
  const groups = buildNavGroups(tree, opt)
  assert.equal(groups[0].label, '未知目录', '分组标题沿用目录名')
  assert.equal(groups[0].items.length, 1, '未登记组件的目录本身不产出可点击项')
  assert.equal(groups[0].items[0].path, '/unknown/child', '子树页面应被提升保留')
  assert.deepEqual(navLeaves(groups).map(l => l.path), ['/unknown/child'])
})

test('超过深度上限的子树被截断，避免异常数据撑爆导航', () => {
  // 构造 9 层嵌套，验证上限之后的层级不再产出节点
  let node: MenuNode = { id: 999, name: '第9层', path: '/l9', component: 'system/user/index' }
  for (let i = 8; i >= 1; i -= 1) {
    node = { id: i, name: `第${i}层`, path: `/l${i}`, component: 'system/user/index', children: [node] }
  }
  const paths = navLeaves(buildNavGroups([node], opt)).map(l => l.path)
  assert.ok(paths.includes('/l6'), '第 6 层应保留')
  assert.ok(!paths.includes('/l7'), `第 7 层起应被截断，实际：${paths.join(', ')}`)
})

test('groupOfPaths 为多级页面标注所属分组', () => {
  const tree: MenuNode[] = [{
    id: 400, name: '商城', path: '/shop',
    children: [{
      id: 401, name: '商品中心', path: '/shop/product',
      children: [{ id: 402, name: '商品列表', path: '/shop/product/list', component: 'system/user/index' }],
    }],
  }]
  const groups = buildNavGroups(tree, opt)
  const map = groupOfPaths(groups)
  assert.equal(map.get('/shop/product/list'), '商城', '深层页面应归属顶层分组标题')
})

test('single 分组的页面不归属任何分组标题', () => {
  const groups = buildNavGroups([{ id: 1, name: '工作台', path: '/dashboard', component: 'system/user/index' }], opt)
  assert.equal(groupOfPaths(groups).get('/dashboard'), '')
})

test('空树与全无有效组件的树产出空分组', () => {
  assert.deepEqual(buildNavGroups([], opt), [])
  assert.deepEqual(buildNavGroups([{ id: 1, name: '空目录' }], opt), [])
})

test('多层页面节点不丢顶层：全链路每一层都可点击', () => {
  // 回归：曾出现顶层页面被自身子树挤掉，导致首层不可达
  let node: MenuNode = { id: 5, name: '第5层', path: '/p5', component: 'system/user/index' }
  for (let i = 4; i >= 1; i -= 1) {
    node = { id: i, name: `第${i}层`, path: `/p${i}`, component: 'system/user/index', children: [node] }
  }
  const paths = navLeaves(buildNavGroups([node], opt)).map(l => l.path)
  assert.deepEqual(paths, ['/p1', '/p2', '/p3', '/p4', '/p5'], '五层页面应全部保留')
})

test('纯目录链末端挂页面时该页面可见', () => {
  // 回归：纯目录链曾整体产出空分组，导致深层页面不可达
  let node: MenuNode = { id: 33, name: '末级目录', path: '/d3' }
  node = { id: 32, name: '二级目录', path: '/d2', children: [node] }
  node = { id: 31, name: '一级目录', path: '/d1', children: [node] }
  assert.deepEqual(buildNavGroups([node], opt), [], '整条链无任何页面时不应产出空壳分组')

  const withPage: MenuNode[] = [{
    id: 40, name: '一级目录', path: '/a',
    children: [{
      id: 41, name: '二级目录', path: '/a/b',
      children: [{ id: 42, name: '最深页面', path: '/a/b/c', component: 'system/user/index' }],
    }],
  }]
  const groups = buildNavGroups(withPage, opt)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items[0].label, '二级目录', '二级目录应作为组内第一个分支')
  assert.deepEqual(navLeaves(groups).map(l => l.path), ['/a/b/c'])
})