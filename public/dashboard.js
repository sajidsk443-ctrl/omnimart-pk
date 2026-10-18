(() => {
  'use strict';
  const token = localStorage.getItem('omnimartToken');
  let user;
  try { user = JSON.parse(localStorage.getItem('omnimartUser') || 'null'); } catch { user = null; }
  if (!token || !user) { location.replace('/login.html'); return; }
  if (user.role !== 'admin') { location.replace('/seller.html'); return; }

  const $ = id => document.getElementById(id);
  const statuses = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
  let allProducts = [];
  $('welcome').textContent = user.name ? `Hi, ${user.name}` : 'Admin dashboard';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...options.headers }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { localStorage.removeItem('omnimartToken'); localStorage.removeItem('omnimartUser'); location.replace('/login.html'); throw new Error('Your session expired. Please sign in again.'); }
    if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
    return data;
  }
  function showMessage(node, message, error = false) {
    node.textContent = message;
    node.classList.toggle('error', error);
  }
  function selectTab(name) {
    document.querySelectorAll('.tab[data-tab]').forEach(button => {
      const active = button.dataset.tab === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${name}`));
    if (name === 'products') loadProducts();
    if (name === 'orders') loadOrders();
  }
  document.querySelectorAll('.tab[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.goto)));
  $('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('omnimartToken'); localStorage.removeItem('omnimartUser'); location.replace('/login.html');
  });

  $('productForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, message = $('productMsg'), button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Saving…'; showMessage(message, '');
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      body.price = Number(body.price); body.stock = Number(body.stock || 0);
      await api('/api/products', { method: 'POST', body: JSON.stringify(body) });
      form.reset(); $('pStock').value = '0'; showMessage(message, 'Product saved successfully.');
      await loadProducts(); updateSummary();
    } catch (error) { showMessage(message, error.message, true); }
    finally { button.disabled = false; button.textContent = 'Save Product'; }
  });

  $('sellerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, message = $('sellerMsg'), button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Creating…'; showMessage(message, '');
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      await api('/api/auth/sellers', { method: 'POST', body: JSON.stringify(body) });
      form.reset(); showMessage(message, 'Seller account created successfully.');
    } catch (error) { showMessage(message, error.message, true); }
    finally { button.disabled = false; button.textContent = 'Create Seller'; }
  });

  $('refreshProducts').addEventListener('click', loadProducts);
  $('refreshOrders').addEventListener('click', loadOrders);
  $('productSearch').addEventListener('input', renderProducts);

  async function loadProducts() {
    const box = $('products'); box.innerHTML = '<p class="loading">Loading products…</p>';
    try { allProducts = await api('/api/products?all=true'); renderProducts(); updateSummary(); }
    catch (error) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
  }
  function renderProducts() {
    const box = $('products'), query = $('productSearch').value.trim().toLowerCase();
    const list = allProducts.filter(product => `${product.name} ${product.category || ''}`.toLowerCase().includes(query));
    box.innerHTML = list.length ? list.map(product => `<article class="row"><div class="rowmain"><div class="rowtitle">${esc(product.name)}</div><div class="muted">PKR ${Number(product.price).toLocaleString()} · Stock ${Number(product.stock) || 0} · ${esc(product.category || 'General')}${product.active ? '' : ' · Inactive'}</div>${product.description ? `<div class="muted">${esc(product.description)}</div>` : ''}</div><button class="danger" type="button" data-delete-product="${esc(product._id)}">Delete</button></article>`).join('') : '<p class="empty">No matching products found.</p>';
    box.querySelectorAll('[data-delete-product]').forEach(button => button.addEventListener('click', () => deleteProduct(button.dataset.deleteProduct)));
  }
  async function deleteProduct(id) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try { await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); allProducts = allProducts.filter(product => product._id !== id); renderProducts(); updateSummary(); }
    catch (error) { alert(error.message); }
  }

  async function loadOrders() {
    const box = $('orders'); box.innerHTML = '<p class="loading">Loading orders…</p>';
    try {
      const orders = await api('/api/orders');
      box.innerHTML = orders.length ? orders.map(order => `<article class="order"><div class="orderhead"><div><div class="rowtitle">${esc(order.customerName)} <span class="small">· ${esc(order.phone)}</span></div><div class="orderdetail">${esc(order.address)}, ${esc(order.city)}<br>${(order.items || []).map(item => `${esc(item.name)} × ${Number(item.quantity)}`).join(' · ')}</div><strong>PKR ${Number(order.total).toLocaleString()}</strong> <span class="badge">COD · ${esc(order.status)}</span><div class="small" style="margin-top:6px">${order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}</div></div><div class="ordercontrols"><label class="small" for="status-${esc(order._id)}">Update status</label><select id="status-${esc(order._id)}">${statuses.map(status => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select><button class="primary" type="button" data-update-order="${esc(order._id)}">Save</button></div></div></article>`).join('') : '<p class="empty">No COD orders yet.</p>';
      box.querySelectorAll('[data-update-order]').forEach(button => button.addEventListener('click', () => updateOrderStatus(button.dataset.updateOrder, button)));
      updateSummary(orders.length);
    } catch (error) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
  }
  async function updateOrderStatus(id, button) {
    const select = $(`status-${id}`), status = select.value;
    button.disabled = true; button.textContent = 'Saving…';
    try { await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadOrders(); }
    catch (error) { alert(error.message); button.disabled = false; button.textContent = 'Save'; }
  }
  async function updateSummary(orderCount) {
    const productCount = allProducts.length;
    if (typeof orderCount === 'number') { $('summary').textContent = `${productCount} product${productCount === 1 ? '' : 's'} in catalogue · ${orderCount} COD order${orderCount === 1 ? '' : 's'}.`; return; }
    $('summary').textContent = `${productCount} product${productCount === 1 ? '' : 's'} in catalogue · Open COD Orders to load order count.`;
  }

  loadProducts();
})();
