# Cart UI Refactor — Responsive & Memory Leak Fix

Cải thiện toàn diện giao diện giỏ hàng: loại bỏ animation gây memory leak trong [CartItemRow](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartItemRow.tsx#238-731), thay bằng skeleton loading, di chuyển [MultiCouponSection](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/MultiCouponSection.tsx#87-774) xuống dưới button thanh toán, và chuẩn hóa UI/UX responsive cho mobile/tablet.

---

## Phân tích vấn đề hiện tại

### 🔴 Memory Leak Issues

1. **[CartItemRow.tsx](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartItemRow.tsx)** — Dùng `motion.div` với `layout` prop + `AnimatePresence` wrapping từng item → `framer-motion` layout tracking không cleanup đúng khi item unmount, gây leak trên danh sách dài.
2. **[page.tsx](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/app/%28protected%29/cart/page.tsx)** — `AnimatePresence` bao toàn bộ cart items list, `motion.div` cho từng coupon trong Order Summary.
3. **[stores/cart.ts](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/stores/cart.ts)** — `"use client"` directive ở top-level store file không cần thiết.

### 🟡 UX Issues

1. **Vị trí [MultiCouponSection](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/MultiCouponSection.tsx#87-774)**: Hiện đang ở **trên** Order Summary card. Cần chuyển xuống **sau** button thanh toán.
2. **Exit animation `x: -100`** trên mobile tạo horizontal shift xấu.
3. **Debug button** (`BugIcon/BugOff`) vẫn render trong production (chỉ ẩn data, không ẩn button).
4. **Skeleton loading**: Chưa có skeleton cho CartItemRow khi hydration.
5. **Responsive**: Mobile layout flex vỡ, unused imports tăng bundle size.

---

## User Review Required

> [!IMPORTANT]
> **Bỏ animation `framer-motion` trong [CartItemRow](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartItemRow.tsx#238-731)** — Animation remove/add item sẽ không còn. Thay bằng CSS transition nhẹ (`transition-all duration-150`). Skeleton loading xuất hiện khi `_hydrated = false`.

> [!WARNING]
> **[MultiCouponSection](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/MultiCouponSection.tsx#87-774) position** — Chuyển xuống dưới button thanh toán trong Order Summary card. Layout sidebar desktop sẽ gọn hơn (bỏ 1 card riêng ở sidebar).

> [!NOTE]
> [CartConfigDialog.tsx](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartConfigDialog.tsx) — Giữ nguyên animation bên trong Dialog vì isolated context, ít risk leak.

---

## Proposed Changes

### Cart Page Layout

#### [MODIFY] [page.tsx](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/app/(protected)/cart/page.tsx)

- Xóa `AnimatePresence` bao quanh cart items list (dòng 1168)
- Xóa `motion.div` cho từng coupon item trong Order Summary (dòng 1295–1322)
- Di chuyển `<MultiCouponSection />` từ đầu sidebar column xuống sau button thanh toán
- Thêm `CartItemRowSkeleton` khi `!_hydrated` (import `useCartHydrated` từ store)
- Xóa `console.log("item for api", itemsForApi)` (dòng 136)
- `max-w-8xl` → `max-w-7xl` (standard Tailwind class)
- Thêm `aria-label` cho main section

---

### CartItemRow Component

#### [MODIFY] [CartItemRow.tsx](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartItemRow.tsx)

**Xóa animation:**
- Xóa `import { motion, AnimatePresence } from "framer-motion"`
- `<motion.div layout initial animate exit className="group">` → `<div className="group transition-all duration-150">`
- Xóa `<motion.div>` trong [CartItemWithSelectStep](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/components/cart/CartItemRow.tsx#53-238)

**Thêm Skeleton export:**
```tsx
export function CartItemRowSkeleton() {
  return (
    <Card className="border border-gray-200 py-3">
      <CardContent className="p-2 sm:p-6 sm:py-2">
        <div className="flex items-start gap-4 animate-pulse">
          <div className="w-5 h-5 bg-gray-200 rounded mt-1 flex-shrink-0" />
          <div className="w-16 h-16 bg-gray-200 rounded-lg flex-shrink-0 hidden sm:block" />
          <div className="flex-1 space-y-3">
            <div className="h-5 bg-gray-200 rounded w-2/3" />
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="h-px bg-gray-100 mt-4" />
            <div className="flex justify-between items-center">
              <div className="h-8 bg-gray-200 rounded w-32" />
              <div className="h-6 bg-gray-200 rounded w-24" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Fix Debug button:**
- Xóa hoàn toàn Button `BugIcon/BugOff` (dòng 465–474)
- Giữ nguyên div data debug (đã có guard `process.env.NODE_ENV !== 'development'`)

**Fix Responsive:**
- Controls khu vực phải: `flex ml-auto lg:w-2/3 items-center justify-between gap-4` → thêm `flex-wrap gap-y-2` để không overflow mobile
- Price text: thêm `break-all` hoặc `min-w-0` để không tràn

**Fix Unused imports:**
- Xóa `import { cy, el } from "date-fns/locale"` (line 50)
- Xóa `useCartItems, useCartCount, useCartSummary, useCartCoupon` khỏi cart imports nếu không dùng trực tiếp
- Xóa `import { Progress }` nếu không dùng

**Accessibility:**
- `<Checkbox>` thêm `aria-label={`Chọn ${cartItem.name}`}`
- Remove button thêm `aria-label={`Xóa ${cartItem.name} khỏi giỏ hàng`}`
- Wrap từng item group với `role="group" aria-label={cartItem.name}`

---

### Cart Store Cleanup

#### [MODIFY] [cart.ts](file:///C:/Users/QuocAnhPC/Desktop/WORKING/NHANHOA/nhanhoa_customer_manage/stores/cart.ts)

- Xóa dòng 1: `"use client"` — Zustand store không cần directive này.
- Thêm export selector `useCartHydrated` để page.tsx dùng cho skeleton:

```ts
export const useCartHydrated = () => useCart((s) => s._hydrated);
```

---

## Verification Plan

### Manual Verification

**Test 1 — Skeleton Loading**
1. DevTools > Application > Local Storage > xóa key `cart-store`
2. Thêm items vào cart từ 1 trang khác trong cùng browser
3. Refresh trang `/cart`
4. **Kỳ vọng**: Thấy skeleton cards trong 1-2 giây trước khi items xuất hiện

**Test 2 — MultiCouponSection Position**
1. Vào `/cart` với ít nhất 1 item
2. Scroll xuống sidebar bên phải
3. **Kỳ vọng**: Section "Mã giảm giá" xuất hiện **dưới** button "Kiểm tra thông tin đơn hàng"

**Test 3 — Mobile Responsive (375px)**
1. DevTools > Toggle Device Toolbar > iPhone SE (375px width)
2. Vào `/cart`, thêm ít nhất 2 items loại khác nhau
3. **Kỳ vọng**: Không có horizontal scroll, tất cả controls hiển thị đúng

**Test 4 — Tablet Responsive (768px)**
1. DevTools > chọn iPad Mini (768px)
2. **Kỳ vọng**: Grid sidebar/main hiển thị 1 cột (breakpoint `lg:` = 1024px)

**Test 5 — Debug Button ẩn**
1. Vào `/cart` trong chế độ production (hoặc NODE_ENV=production)
2. **Kỳ vọng**: Không thấy nút Bug icon đỏ bên cạnh domain name

**Test 6 — No Animation Flash**
1. Xóa 1 item khỏi giỏ hàng
2. **Kỳ vọng**: Item biến mất trực tiếp (không có slide-out animation), không có horizontal shift

**Test 7 — TypeScript Compilation**
```powershell
cd C:\Users\QuocAnhPC\Desktop\WORKING\NHANHOA\nhanhoa_customer_manage
npx tsc --noEmit
```
**Kỳ vọng**: 0 errors
