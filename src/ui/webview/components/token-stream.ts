export class TokenStreamComponent {
  private element: HTMLElement;
  private content = '';

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'token-stream';
    container.appendChild(this.element);
  }

  public appendToken(text: string): void {
    this.content += text;
    this.element.textContent = this.content;
    this.element.scrollTop = this.element.scrollHeight;
  }

  public clear(): void {
    this.content = '';
    this.element.textContent = '';
  }
}
