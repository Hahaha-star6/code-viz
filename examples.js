/* 内置示例代码（全部可直接运行） */
(function (global) {
  'use strict';

  const EXAMPLES = [
    {
      name: '① 冒泡排序（数组）',
      algo: 'bubble',
      lang: 'c',
      code: `#include <stdio.h>
#define N 8

int main() {
    int a[N] = {42, 18, 65, 30, 9, 51, 27, 76};
    int i, j, t;

    for (i = 0; i < N - 1; i++) {
        for (j = 0; j < N - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                t = a[j];
                a[j] = a[j + 1];
                a[j + 1] = t;
            }
        }
    }

    printf("排序结果: ");
    for (i = 0; i < N; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '② 直接插入排序',
      code: `#include <stdio.h>

int main() {
    int a[8] = {20, 60, 30, 10, 40, 90, 80, 70};
    int i, j, key;

    for (i = 1; i < 8; i++) {
        key = a[i];
        j = i - 1;
        while (j >= 0 && a[j] > key) {
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = key;
    }

    printf("插入排序结果: ");
    for (i = 0; i < 8; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '③ 快速排序（递归）',
      code: `#include <stdio.h>

int partition(int a[], int low, int high) {
    int pivot = a[low];
    while (low < high) {
        while (low < high && a[high] >= pivot) high--;
        a[low] = a[high];
        while (low < high && a[low] <= pivot) low++;
        a[high] = a[low];
    }
    a[low] = pivot;
    return low;
}

void quickSort(int a[], int low, int high) {
    if (low < high) {
        int p = partition(a, low, high);
        quickSort(a, low, p - 1);
        quickSort(a, p + 1, high);
    }
}

int main() {
    int a[8] = {49, 38, 65, 97, 76, 13, 27, 49};
    quickSort(a, 0, 7);
    printf("快速排序结果: ");
    for (int i = 0; i < 8; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '④ 折半查找',
      algo: 'binsearch',
      lang: 'c',
      code: `#include <stdio.h>

int main() {
    int a[10] = {7, 12, 19, 25, 33, 41, 56, 68, 79, 91};
    int target = 41;
    int low = 0, high = 9, mid = -1;
    int found = -1;

    while (low <= high) {
        mid = (low + high) / 2;
        if (a[mid] == target) {
            found = mid;
            break;
        } else if (a[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (found >= 0) printf("找到 %d，下标是 %d\\n", target, found);
    else printf("没有找到 %d\\n", target);
    return 0;
}`
    },
    {
      name: '⑤ 单链表（头插法）',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int data;
    struct Node *next;
} Node;

int main() {
    Node *head = NULL;
    int i;

    for (i = 1; i <= 5; i++) {
        Node *p = (Node *)malloc(sizeof(Node));
        p->data = i * 10;
        p->next = head;
        head = p;
    }

    Node *q = head;
    printf("链表内容: ");
    while (q != NULL) {
        printf("%d -> ", q->data);
        q = q->next;
    }
    printf("NULL\\n");
    return 0;
}`
    },
    {
      name: '⑥ 栈-括号匹配',
      code: `#include <stdio.h>

int main() {
    char *s = "{[()()]}";
    char stack[12];
    int top = -1;
    int i;
    int ok = 1;

    for (i = 0; s[i] != '\\0'; i++) {
        if (s[i] == '(' || s[i] == '[' || s[i] == '{') {
            top++;
            stack[top] = s[i];
        } else {
            if (top < 0) { ok = 0; break; }
            char c = stack[top];
            top--;
            if (s[i] == ')' && c != '(') { ok = 0; break; }
            if (s[i] == ']' && c != '[') { ok = 0; break; }
            if (s[i] == '}' && c != '{') { ok = 0; break; }
        }
    }

    if (ok && top == -1) printf("括号匹配成功\\n");
    else printf("括号匹配失败\\n");
    return 0;
}`
    },
    {
      name: '⑦ 递归-斐波那契',
      code: `#include <stdio.h>

int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

int main() {
    int n = 6;
    int r = fib(n);
    printf("fib(%d) = %d\\n", n, r);
    return 0;
}`
    },
    {
      name: '⑧ 二叉树-中序遍历',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct TreeNode {
    int data;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;

TreeNode *newNode(int x) {
    TreeNode *p = (TreeNode *)malloc(sizeof(TreeNode));
    p->data = x;
    p->left = NULL;
    p->right = NULL;
    return p;
}

void inorder(TreeNode *t) {
    if (t == NULL) return;
    inorder(t->left);
    printf("%d ", t->data);
    inorder(t->right);
}

int main() {
    TreeNode *root = newNode(1);
    root->left = newNode(2);
    root->right = newNode(3);
    root->left->left = newNode(4);
    root->left->right = newNode(5);
    root->right->left = newNode(6);

    printf("中序遍历: ");
    inorder(root);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑨ 顺序表（结构体+数组）',
      code: `#include <stdio.h>
#define MAX 12

typedef struct {
    int data[MAX];
    int length;
} SqList;

int main() {
    SqList L;
    int i;

    L.length = 0;
    for (i = 0; i < 6; i++) {
        L.data[i] = (i + 1) * 10;
        L.length++;
    }

    /* 在下标 2 处插入 99：元素后移 */
    for (i = L.length; i > 2; i--) {
        L.data[i] = L.data[i - 1];
    }
    L.data[2] = 99;
    L.length++;

    printf("顺序表: ");
    for (i = 0; i < L.length; i++) printf("%d ", L.data[i]);
    printf("\\n长度 = %d\\n", L.length);
    return 0;
}`
    },
    {
      name: '⑩ 结构体数组（按分数排序）',
      code: `#include <stdio.h>

typedef struct {
    int id;
    int score;
} Student;

int main() {
    Student st[6];
    Student t;
    int i, j;

    for (i = 0; i < 6; i++) {
        st[i].id = i + 1;
        st[i].score = 58 + (i * 13) % 40;
    }

    /* 按分数从高到低冒泡排序 */
    for (i = 0; i < 5; i++) {
        for (j = 0; j < 5 - i; j++) {
            if (st[j].score < st[j + 1].score) {
                t = st[j];
                st[j] = st[j + 1];
                st[j + 1] = t;
            }
        }
    }

    printf("排名: ");
    for (i = 0; i < 6; i++) {
        printf("%d号%d分  ", st[i].id, st[i].score);
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑪ 图-邻接矩阵 BFS',
      code: `#include <stdio.h>

int main() {
    int g[6][6] = {
        {0, 1, 1, 0, 0, 0},
        {1, 0, 0, 1, 1, 0},
        {1, 0, 0, 0, 1, 0},
        {0, 1, 0, 0, 0, 1},
        {0, 1, 1, 0, 0, 1},
        {0, 0, 0, 1, 1, 0}
    };
    int visited[6] = {0, 0, 0, 0, 0, 0};
    int queue[12];
    int front = 0, rear = 0;
    int u, v;
    int start = 0;

    visited[start] = 1;
    queue[rear] = start;
    rear++;

    while (front < rear) {
        u = queue[front];
        front++;
        printf("访问 %d\\n", u);

        for (v = 0; v < 6; v++) {
            if (g[u][v] == 1 && visited[v] == 0) {
                visited[v] = 1;
                queue[rear] = v;
                rear++;
            }
        }
    }
    return 0;
}`
    },
    {
      name: '⑫ 图-Dijkstra 最短路',
      code: `#include <stdio.h>
#define N 5
#define INF 9999

int main() {
    int g[N][N] = {
        {0, 10, INF, 30, 100},
        {10, 0, 50, 0, 0},
        {INF, 50, 0, 20, 10},
        {30, 0, 20, 0, 60},
        {100, 0, 10, 60, 0}
    };
    int dist[N];
    int visited[N] = {0, 0, 0, 0, 0};
    int i, j, k, min;

    for (i = 0; i < N; i++) dist[i] = g[0][i];

    for (i = 0; i < N; i++) {
        min = INF;
        k = -1;
        for (j = 0; j < N; j++) {
            if (visited[j] == 0 && dist[j] < min) {
                min = dist[j];
                k = j;
            }
        }
        if (k == -1) break;
        visited[k] = 1;

        for (j = 0; j < N; j++) {
            if (visited[j] == 0 && g[k][j] < INF && dist[k] + g[k][j] < dist[j]) {
                dist[j] = dist[k] + g[k][j];
            }
        }
    }

    printf("起点 0 到各点最短路: ");
    for (i = 0; i < N; i++) printf("%d ", dist[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑬ 双向链表',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct DNode {
    int data;
    struct DNode *prior;
    struct DNode *next;
} DNode;

int main() {
    DNode *head = NULL;
    DNode *tail = NULL;
    int i;

    /* 尾插法建立双向链表 */
    for (i = 1; i <= 4; i++) {
        DNode *p = (DNode *)malloc(sizeof(DNode));
        p->data = i * 10;
        p->next = NULL;
        p->prior = tail;
        if (tail != NULL) tail->next = p;
        else head = p;
        tail = p;
    }

    printf("正向: ");
    DNode *q = head;
    while (q != NULL) {
        printf("%d ", q->data);
        q = q->next;
    }

    printf("\\n反向: ");
    q = tail;
    while (q != NULL) {
        printf("%d ", q->data);
        q = q->prior;
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑭ 图-邻接表 DFS',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct ArcNode {
    int adjvex;
    struct ArcNode *next;
} ArcNode;

int visited[5] = {0, 0, 0, 0, 0};

void addEdge(ArcNode adj[], int u, int v) {
    ArcNode *p = (ArcNode *)malloc(sizeof(ArcNode));
    p->adjvex = v;
    p->next = adj[u].next;
    adj[u].next = p;
}

void dfs(ArcNode adj[], int u) {
    printf("%d ", u);
    visited[u] = 1;
    ArcNode *p = adj[u].next;
    while (p != NULL) {
        if (visited[p->adjvex] == 0) dfs(adj, p->adjvex);
        p = p->next;
    }
}

int main() {
    ArcNode adj[5];
    int i;

    for (i = 0; i < 5; i++) {
        adj[i].adjvex = i;
        adj[i].next = NULL;
    }

    addEdge(adj, 0, 1); addEdge(adj, 1, 0);
    addEdge(adj, 0, 2); addEdge(adj, 2, 0);
    addEdge(adj, 1, 3); addEdge(adj, 3, 1);
    addEdge(adj, 2, 4); addEdge(adj, 4, 2);
    addEdge(adj, 3, 4); addEdge(adj, 4, 3);

    printf("DFS: ");
    dfs(adj, 0);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑮ 图-邻接表（firstarc）',
      code: `#include <stdio.h>
#include <stdlib.h>
#define N 5

typedef struct ArcNode {
    int adjvex;
    int weight;
    struct ArcNode *next;
} ArcNode;

typedef struct VNode {
    int data;
    ArcNode *firstarc;
} VNode;

void addArc(VNode g[], int u, int v, int w) {
    ArcNode *p = (ArcNode *)malloc(sizeof(ArcNode));
    p->adjvex = v;
    p->weight = w;
    p->next = g[u].firstarc;
    g[u].firstarc = p;
}

int main() {
    VNode g[N];
    int i;

    for (i = 0; i < N; i++) {
        g[i].data = i;
        g[i].firstarc = NULL;
    }

    addArc(g, 0, 1, 4); addArc(g, 1, 0, 4);
    addArc(g, 0, 2, 2); addArc(g, 2, 0, 2);
    addArc(g, 1, 3, 5); addArc(g, 3, 1, 5);
    addArc(g, 2, 3, 1); addArc(g, 3, 2, 1);
    addArc(g, 3, 4, 3); addArc(g, 4, 3, 3);

    for (i = 0; i < N; i++) {
        printf("%d:", i);
        ArcNode *p = g[i].firstarc;
        while (p != NULL) {
            printf(" %d(%d)", p->adjvex, p->weight);
            p = p->next;
        }
        printf("\\n");
    }
    return 0;
}`
    },
    {
      name: '⑯ Python 冒泡排序',
      algo: 'bubble',
      lang: 'python',
      cat: '排序',
      code: `def bubble(a, n):
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]:
                t = a[j]
                a[j] = a[j + 1]
                a[j + 1] = t

a = [42, 18, 65, 30, 9, 51, 27, 76]
bubble(a, 8)
print("sorted:", a)
`
    },
    {
      name: '⑰ Java 冒泡排序',
      algo: 'bubble',
      lang: 'java',
      cat: '排序',
      code: `public class Main {
    static void bubble(int[] a, int n) {
        for (int i = 0; i < n - 1; i++) {
            for (int j = 0; j < n - 1 - i; j++) {
                if (a[j] > a[j + 1]) {
                    int t = a[j];
                    a[j] = a[j + 1];
                    a[j + 1] = t;
                }
            }
        }
    }

    public static void main(String[] args) {
        int[] a = {42, 18, 65, 30, 9, 51, 27, 76};
        bubble(a, 8);
        System.out.print("sorted: ");
        for (int i = 0; i < a.length; i++) {
            System.out.print(a[i]);
            System.out.print(" ");
        }
        System.out.println();
    }
}
`
    },
    {
      name: '⑱ C++ 冒泡排序',
      algo: 'bubble',
      lang: 'cpp',
      cat: '排序',
      code: `#include <iostream>
using namespace std;

int main() {
    int a[6] = {42, 18, 65, 30, 9, 51};
    int i, j, t;
    for (i = 0; i < 5; i++) {
        for (j = 0; j < 5 - i; j++) {
            if (a[j] > a[j + 1]) {
                t = a[j];
                a[j] = a[j + 1];
                a[j + 1] = t;
            }
        }
    }
    for (i = 0; i < 6; i++) cout << a[i] << " ";
    cout << endl;
    return 0;
}
`
    },
    {
      name: '⑲ 选择排序',
      algo: 'selection',
      lang: 'c',
      cat: '排序',
      code: `#include <stdio.h>
#define N 8

int main() {
    int a[N] = {42, 18, 65, 30, 9, 51, 27, 76};
    int i, j, k, t;

    for (i = 0; i < N - 1; i++) {
        k = i;
        for (j = i + 1; j < N; j++) {
            if (a[j] < a[k]) k = j;
        }
        if (k != i) {
            t = a[i];
            a[i] = a[k];
            a[k] = t;
        }
    }

    printf("选择排序结果: ");
    for (i = 0; i < N; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '⑳ 希尔排序',
      cat: '排序',
      code: `#include <stdio.h>

int main() {
    int a[10] = {49, 38, 65, 97, 76, 13, 27, 49, 55, 4};
    int n = 10;
    int gap, i, j, t;

    for (gap = n / 2; gap > 0; gap = gap / 2) {
        for (i = gap; i < n; i++) {
            t = a[i];
            j = i - gap;
            while (j >= 0 && a[j] > t) {
                a[j + gap] = a[j];
                j = j - gap;
            }
            a[j + gap] = t;
        }
    }

    printf("希尔排序结果: ");
    for (i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉑ 归并排序（递归）',
      cat: '排序',
      code: `#include <stdio.h>

void merge(int a[], int tmp[], int low, int mid, int high) {
    int i = low, j = mid + 1, k = low;
    while (i <= mid && j <= high) {
        if (a[i] <= a[j]) {
            tmp[k] = a[i];
            k++;
            i++;
        } else {
            tmp[k] = a[j];
            k++;
            j++;
        }
    }
    while (i <= mid) {
        tmp[k] = a[i];
        k++;
        i++;
    }
    while (j <= high) {
        tmp[k] = a[j];
        k++;
        j++;
    }
    for (k = low; k <= high; k++) a[k] = tmp[k];
}

void mergeSort(int a[], int tmp[], int low, int high) {
    if (low < high) {
        int mid = (low + high) / 2;
        mergeSort(a, tmp, low, mid);
        mergeSort(a, tmp, mid + 1, high);
        merge(a, tmp, low, mid, high);
    }
}

int main() {
    int a[8] = {49, 38, 65, 97, 76, 13, 27, 49};
    int tmp[8];
    int i;

    mergeSort(a, tmp, 0, 7);
    printf("归并排序结果: ");
    for (i = 0; i < 8; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉒ 堆排序',
      cat: '排序',
      code: `#include <stdio.h>

void sift(int a[], int low, int high) {
    int i = low;
    int j = 2 * i + 1;
    int t = a[i];

    while (j <= high) {
        if (j + 1 <= high && a[j] < a[j + 1]) j++;
        if (t < a[j]) {
            a[i] = a[j];
            i = j;
            j = 2 * i + 1;
        } else {
            break;
        }
    }
    a[i] = t;
}

int main() {
    int a[8] = {49, 38, 65, 97, 76, 13, 27, 49};
    int n = 8, i, t;

    for (i = n / 2 - 1; i >= 0; i--) sift(a, i, n - 1);

    for (i = n - 1; i > 0; i--) {
        t = a[0];
        a[0] = a[i];
        a[i] = t;
        sift(a, 0, i - 1);
    }

    printf("堆排序结果: ");
    for (i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉓ 顺序查找',
      cat: '查找',
      code: `#include <stdio.h>

int main() {
    int a[10] = {7, 12, 19, 25, 33, 41, 56, 68, 79, 91};
    int target = 56;
    int i, pos = -1;

    for (i = 0; i < 10; i++) {
        if (a[i] == target) {
            pos = i;
            break;
        }
    }

    if (pos >= 0) printf("找到 %d，下标是 %d\\n", target, pos);
    else printf("没有找到 %d\\n", target);
    return 0;
}`
    },
    {
      name: '㉔ 循环队列（入队/出队）',
      cat: '栈与队列',
      code: `#include <stdio.h>
#define MAX 6

int main() {
    int q[MAX];
    int front = 0, rear = 0;
    int i;

    /* 依次入队 5 个元素 */
    for (i = 0; i < 5; i++) {
        q[rear] = (i + 1) * 10;
        rear = (rear + 1) % MAX;
    }

    printf("出队: ");
    while (front != rear) {
        printf("%d ", q[front]);
        front = (front + 1) % MAX;
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉕ 链栈（入栈/出栈）',
      cat: '栈与队列',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct StackNode {
    int data;
    struct StackNode *next;
} StackNode;

int main() {
    StackNode *top = NULL;
    int i;

    for (i = 1; i <= 5; i++) {
        StackNode *p = (StackNode *)malloc(sizeof(StackNode));
        p->data = i * 10;
        p->next = top;
        top = p;
    }

    printf("出栈: ");
    while (top != NULL) {
        printf("%d ", top->data);
        StackNode *t = top;
        top = top->next;
        free(t);
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉖ 进制转换（栈）',
      cat: '栈与队列',
      code: `#include <stdio.h>

int main() {
    int n = 156;
    int stack[32];
    int top = -1;

    while (n > 0) {
        top++;
        stack[top] = n % 2;
        n = n / 2;
    }

    printf("156 的二进制: ");
    while (top >= 0) {
        printf("%d", stack[top]);
        top--;
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉗ 单链表就地逆置',
      cat: '线性表',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int data;
    struct Node *next;
} Node;

int main() {
    Node *head = NULL;
    int i;

    for (i = 1; i <= 5; i++) {
        Node *p = (Node *)malloc(sizeof(Node));
        p->data = i * 10;
        p->next = head;
        head = p;
    }

    Node *pre = NULL;
    Node *cur = head;
    Node *next;
    while (cur != NULL) {
        next = cur->next;
        cur->next = pre;
        pre = cur;
        cur = next;
    }
    head = pre;

    printf("逆置后: ");
    Node *q = head;
    while (q != NULL) {
        printf("%d -> ", q->data);
        q = q->next;
    }
    printf("NULL\\n");
    return 0;
}`
    },
    {
      name: '㉘ 两个有序表合并',
      cat: '线性表',
      code: `#include <stdio.h>

int main() {
    int a[5] = {3, 8, 15, 21, 30};
    int b[5] = {1, 9, 16, 22, 35};
    int c[10];
    int i = 0, j = 0, k = 0;

    while (i < 5 && j < 5) {
        if (a[i] <= b[j]) {
            c[k] = a[i];
            k++;
            i++;
        } else {
            c[k] = b[j];
            k++;
            j++;
        }
    }
    while (i < 5) {
        c[k] = a[i];
        k++;
        i++;
    }
    while (j < 5) {
        c[k] = b[j];
        k++;
        j++;
    }

    printf("合并结果: ");
    for (i = 0; i < 10; i++) printf("%d ", c[i]);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉙ 循环链表（约瑟夫环）',
      cat: '线性表',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int id;
    struct Node *next;
} Node;

int main() {
    int n = 6, m = 3;
    Node *head = NULL, *tail = NULL;
    int i;

    for (i = 1; i <= n; i++) {
        Node *p = (Node *)malloc(sizeof(Node));
        p->id = i;
        p->next = NULL;
        if (tail == NULL) head = p;
        else tail->next = p;
        tail = p;
    }
    tail->next = head;

    Node *pre = tail;
    Node *cur = head;
    printf("出圈顺序: ");
    while (cur->next != cur) {
        for (i = 1; i < m; i++) {
            pre = cur;
            cur = cur->next;
        }
        printf("%d ", cur->id);
        pre->next = cur->next;
        Node *t = cur;
        cur = cur->next;
        free(t);
    }
    printf("%d\\n", cur->id);
    return 0;
}`
    },
    {
      name: '㉚ 二叉树-前序遍历',
      cat: '树',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct TreeNode {
    int data;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;

TreeNode *newNode(int x) {
    TreeNode *p = (TreeNode *)malloc(sizeof(TreeNode));
    p->data = x;
    p->left = NULL;
    p->right = NULL;
    return p;
}

void preorder(TreeNode *t) {
    if (t == NULL) return;
    printf("%d ", t->data);
    preorder(t->left);
    preorder(t->right);
}

int main() {
    TreeNode *root = newNode(1);
    root->left = newNode(2);
    root->right = newNode(3);
    root->left->left = newNode(4);
    root->left->right = newNode(5);
    root->right->left = newNode(6);

    printf("前序遍历: ");
    preorder(root);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉛ 二叉树-层序遍历（队列）',
      cat: '树',
      code: `#include <stdio.h>
#include <stdlib.h>

typedef struct TreeNode {
    int data;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;

TreeNode *newNode(int x) {
    TreeNode *p = (TreeNode *)malloc(sizeof(TreeNode));
    p->data = x;
    p->left = NULL;
    p->right = NULL;
    return p;
}

int main() {
    TreeNode *root = newNode(1);
    root->left = newNode(2);
    root->right = newNode(3);
    root->left->left = newNode(4);
    root->left->right = newNode(5);
    root->right->left = newNode(6);

    TreeNode *queue[16];
    int front = 0, rear = 0;
    queue[rear] = root;
    rear++;

    printf("层序遍历: ");
    while (front < rear) {
        TreeNode *t = queue[front];
        front++;
        printf("%d ", t->data);
        if (t->left != NULL) {
            queue[rear] = t->left;
            rear++;
        }
        if (t->right != NULL) {
            queue[rear] = t->right;
            rear++;
        }
    }
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉜ 图-邻接矩阵 DFS',
      cat: '图',
      code: `#include <stdio.h>

int g[6][6] = {
    {0, 1, 1, 0, 0, 0},
    {1, 0, 0, 1, 1, 0},
    {1, 0, 0, 0, 1, 0},
    {0, 1, 0, 0, 0, 1},
    {0, 1, 1, 0, 0, 1},
    {0, 0, 0, 1, 1, 0}
};
int visited[6] = {0, 0, 0, 0, 0, 0};

void dfs(int u) {
    int v;
    printf("%d ", u);
    visited[u] = 1;
    for (v = 0; v < 6; v++) {
        if (g[u][v] == 1 && visited[v] == 0) dfs(v);
    }
}

int main() {
    printf("DFS: ");
    dfs(0);
    printf("\\n");
    return 0;
}`
    },
    {
      name: '㉝ 图-Prim 最小生成树',
      cat: '图',
      code: `#include <stdio.h>
#define N 5
#define INF 9999

int main() {
    int g[N][N] = {
        {0, 4, INF, 6, INF},
        {4, 0, 3, 8, INF},
        {INF, 3, 0, 2, 7},
        {6, 8, 2, 0, 5},
        {INF, INF, 7, 5, 0}
    };
    int low[N];
    int visited[N];
    int i, j, k, min, sum = 0;

    for (i = 0; i < N; i++) {
        low[i] = g[0][i];
        visited[i] = 0;
    }
    visited[0] = 1;

    for (i = 1; i < N; i++) {
        min = INF;
        k = -1;
        for (j = 0; j < N; j++) {
            if (visited[j] == 0 && low[j] < min) {
                min = low[j];
                k = j;
            }
        }
        if (k == -1) break;
        visited[k] = 1;
        sum = sum + min;
        printf("加入顶点 %d，边权 %d\\n", k, min);
        for (j = 0; j < N; j++) {
            if (visited[j] == 0 && g[k][j] < low[j]) {
                low[j] = g[k][j];
            }
        }
    }

    printf("最小生成树权值 = %d\\n", sum);
    return 0;
}`
    },
    {
      name: '㉞ 递归-汉诺塔',
      cat: '递归',
      code: `#include <stdio.h>

int moves = 0;

void hanoi(int n, char from, char aux, char to) {
    if (n == 1) {
        moves++;
        printf("%d: %c -> %c\\n", moves, from, to);
        return;
    }
    hanoi(n - 1, from, to, aux);
    moves++;
    printf("%d: %c -> %c\\n", moves, from, to);
    hanoi(n - 1, aux, from, to);
}

int main() {
    hanoi(3, 'A', 'B', 'C');
    printf("共 %d 步\\n", moves);
    return 0;
}`
    },
    {
      name: '㉟ 递归-最大公约数',
      cat: '递归',
      code: `#include <stdio.h>

int gcd(int a, int b) {
    if (b == 0) return a;
    return gcd(b, a % b);
}

int main() {
    int a = 48, b = 18;
    printf("gcd(%d, %d) = %d\\n", a, b, gcd(a, b));
    printf("gcd(1071, 462) = %d\\n", gcd(1071, 462));
    return 0;
}`
    },
    {
      name: '㊱ Python 选择排序',
      algo: 'selection',
      lang: 'python',
      cat: '排序',
      code: `def select_sort(a, n):
    for i in range(n - 1):
        k = i
        for j in range(i + 1, n):
            if a[j] < a[k]:
                k = j
        if k != i:
            t = a[i]
            a[i] = a[k]
            a[k] = t

a = [42, 18, 65, 30, 9, 51, 27, 76]
select_sort(a, 8)
print("sorted:", a)
`
    },
    {
      name: '㊲ Java 折半查找',
      algo: 'binsearch',
      lang: 'java',
      cat: '查找',
      code: `public class Main {
    static void binarySearch(int[] a, int n, int target) {
        int low = 0, high = n - 1, mid;
        while (low <= high) {
            mid = (low + high) / 2;
            if (a[mid] == target) {
                System.out.println("找到，下标 " + mid);
                return;
            } else if (a[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        System.out.println("未找到");
    }

    public static void main(String[] args) {
        int[] a = {7, 12, 19, 25, 33, 41, 56, 68, 79, 91};
        binarySearch(a, 10, 41);
    }
}
`
    },
    {
      name: '㊳ switch 成绩等级',
      cat: '基础',
      code: `#include <stdio.h>

int main() {
    int scores[5] = {95, 82, 71, 60, 45};
    int i;

    for (i = 0; i < 5; i++) {
        int s = scores[i] / 10;
        printf("%d 分: ", scores[i]);
        switch (s) {
            case 10:
            case 9:
                printf("A\\n");
                break;
            case 8:
                printf("B\\n");
                break;
            case 7:
                printf("C\\n");
                break;
            case 6:
                printf("D\\n");
                break;
            default:
                printf("E\\n");
        }
    }
    return 0;
}`
    },
    {
      name: '㊴ 字符串比较与拼接',
      cat: '基础',
      code: `#include <stdio.h>
#include <string.h>

int main() {
    char a[20] = "apple";
    char b[20] = "banana";
    char c[40];

    printf("strcmp(a, b) = %d\\n", strcmp(a, b));

    strcpy(c, a);
    strcat(c, "-");
    strcat(c, b);
    printf("拼接结果: %s\\n", c);
    printf("长度: %d\\n", strlen(c));
    return 0;
}`
    },
    {
      name: '㊵ 读取输入（scanf）',
      cat: '输入',
      input: '5\n3 1 4 1 5',
      code: `#include <stdio.h>

int main() {
    int n;
    int a[8];
    int i, maxv;

    scanf("%d", &n);
    for (i = 0; i < n; i++) scanf("%d", &a[i]);

    maxv = a[0];
    for (i = 1; i < n; i++) {
        if (a[i] > maxv) maxv = a[i];
    }

    printf("最大值: %d\\n", maxv);
    return 0;
}`
    },
    {
      name: '㊶ Python 读取输入',
      cat: '输入',
      input: '3\n10 20 30',
      code: `n = int(input())
a = [0] * n
for i in range(n):
    a[i] = int(input())

s = 0
for x in a:
    s += x

print(f"n={n}, sum={s}")
`
    }
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
  else global.EXAMPLES = EXAMPLES;
})(typeof window !== 'undefined' ? window : globalThis);
